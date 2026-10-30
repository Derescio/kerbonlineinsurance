# 2.3 Form components

**Status:** in review
**Phase:** 02-design-system

## Goal

Port the five form components to typed TSX, so the quote, claim and account forms in Phases 4–6 can be built from accessible, keyboard-friendly Kerb controls that render the same on the server and in the browser.

## In scope

- **Components** in `src/components/forms/`, props typed from the `.d.ts`:

  | Component | Figma (Forms `4:6`) | Notes |
  |---|---|---|
  | `Field` (shared) | (inside Input/Select) | Label, "(optional)", hint, error. Used by Input and Select |
  | `Input` | `7:96` (default/plate × default/focus/error/disabled) | `iconLeft` takes `IconName` |
  | `Select` | `7:131` | Native `<select>` |
  | `Checkbox` | `7:157` | |
  | `Radio` + `RadioGroup` | `7:179` | `RadioGroup` is new (see fixes) |
  | `Switch` | `7:197` | `role="switch"` |

  The CSS is already in `src/styles/components.css` (2.2). Focus, error and disabled looks come from it.
- **Fixes while porting:**
  - **IDs from `useId()`.** The originals use a module-level counter (`kb-in-1`, `kb-in-2`…), which gives different IDs on the server and in the browser, so hydration fails. `useId()` is stable across both. A passed `id` still wins.
  - **One `Field`.** Input and Select each carry a copy of the same `Field`. Make it one shared component, and add `aria-describedby` to Select (Input had it; Select didn't).
  - **Select placeholder without `required`.** The original sets `required` whenever there's a placeholder, only to grey out the placeholder via `select:invalid`. That makes every such select required and blocks native form submission. Instead, grey the placeholder with `select:has(option[value=""]:checked)` (an "App additions" rule in `components.css`), and leave `required` to the caller.
  - **Descriptions are read out.** Checkbox and Radio show a `description` but don't link it. Link it with `aria-describedby`.
  - **`RadioGroup`:** a `<fieldset>` with a `<legend>`, optional hint and error. It's the accessible group label a set of radios needs ("How do you want to pay?"). Same field typography as `Field`, and no new design: the legend uses `.kb-field__label`. Arrow keys between radios come from the browser, because radios share a `name`.
  - **Errors** use `aria-invalid` + `aria-describedby` and no live region. Forms show errors after submit, and the error-summary pattern comes with the first real form (Phase 4).
- **Forwarded refs** on the native inputs (React 19 `ref` as a prop), so form libraries can focus a field with an error.

## Out of scope

- Form state and validation (Zod comes with the first real form, 4.4/5.x).
- Date, address and postcode pickers (built with the quote flow, Phase 5).
- The segmented "Car condition" control on the Display page's Mobile components (Phase 5).
- Stepper (2.4, Navigation).

## Sources

- `../components/forms/*` (`.jsx`, `.d.ts`, `.prompt.md`), `../components/forms.card.html`, the field/control/check/switch blocks in `src/styles/components.css`.
- Figma Forms `4:6` (see [figma.md](../../figma.md)).

## Files

- `src/components/forms/{Field,Input,Select,Checkbox,Radio,RadioGroup,Switch}.tsx`
- `src/components/forms/forms.browser.test.tsx`
- `src/styles/components.css` (placeholder rule in "App additions")

## Steps

- [x] `Field` (label, optional, hint, error with the `circle-alert` icon) and its ID scheme: `{id}-hint`, `{id}-error`.
- [x] `Input` (default + plate, icon, prefix, suffix), then `Select` (string or `{value,label}` options, placeholder).
- [x] `Checkbox`, `Radio`, `RadioGroup`, `Switch`.
- [x] Placeholder CSS rule; remove the `required` coupling.
- [x] Browser tests (below).
- [x] Temporary page with every component and state, screenshot in Chromium next to Figma Forms `4:6`; check that server-rendered IDs match the browser's (no hydration warning in the console); put `/` back.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Component | Input: label is tied to the input (`getByLabelText`); "(optional)" shown; hint linked by `aria-describedby`; error replaces the hint, links it, sets `aria-invalid` and the error class | yes |
| Component | Input: plate variant class; prefix/suffix text; disabled input can't be typed into; a passed `id` wins over the generated one; `ref` reaches the `<input>` | yes |
| Component | Select: label tied; placeholder shown and not selectable; not `required` unless asked; string and `{value,label}` options; error linked; arrow keys change the value | yes |
| Component | Checkbox: label toggles it; Space toggles when focused; description linked; disabled doesn't toggle | yes |
| Component | RadioGroup: `group` role named by the legend; arrow keys move selection between radios; error linked to the group; description of each radio linked | yes |
| Component | Switch: `role="switch"`, named by its label; Space toggles; `aria-checked` follows; `labelPosition="end"` class | yes |
| Component | Focus: Tab reaches Input, Select, Checkbox, Radio and Switch, and each shows its focus style (halo on controls, ring on box/track) | yes |
| Manual | Every component and state next to Figma Forms `4:6` | yes |
| Manual | No hydration warning in the console on a server-rendered page with several fields | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green.
- [x] No module-level ID counters left in `src/components`.
- [ ] Manual checks pass.

## Results (30 Oct 2026)

Changes from the spec:
- **Checkbox and Radio are named by their label text only** (`aria-labelledby`). The tests showed that wrapping the description inside the `<label>` made the name "Monthly 12 payments of £38.20", and the description was then read a second time.
- **Plate error and disabled states.** The Figma comparison showed them (`7:71`, `7:86`), but in the original CSS the plate rule comes after the state rules and overrides them: a plate with an error kept its dark border, and a disabled plate stayed yellow. Restated in "App additions (2.3)" and covered by a test.
- `Field` is split into `Field`, `FieldMessage`, `OptionalMark` and `describedBy()`, so `RadioGroup` reuses the hint/error and "(optional)" parts without the `<label>`.

What was built:
- `src/components/forms/{Field,Input,Select,Checkbox,Radio,RadioGroup,Switch}.tsx`. IDs come from `useId()`; native inputs take `ref` (React 19).
- `components.css` "App additions (2.3)": select placeholder grey via `:has(option[value=""]:checked)` (no `required`), fieldset reset for `RadioGroup`, plate error/disabled.
- `forms.browser.test.tsx`: 17 tests (labels, hints, errors and `aria-describedby`, plate states, disabled, `ref`, select placeholder/options/arrow keys, checkbox label + Space, radio group name + arrow keys + error, switch role + Space, Tab and focus style on all five controls).
- Checked locally: 77/77 tests; `vp check` and `vp build` clean; no module-level ID counters. A server-rendered temporary page with every component and state has `useId` IDs in the HTML and no console errors or warnings (no hydration mismatch), and matches Figma Forms `4:6` after the plate fix. `/` was put back.

## Commit message

`feat: form components in TSX, with accessible fields and radio groups`
