# 2.4b Navigation and insurance components

**Status:** approved (split from 2.4 on 30 Oct 2026)
**Phase:** 02-design-system

## Goal

Port Tabs, Stepper, CoverageOption and Timeline to typed TSX with full keyboard support, so the quote flow (Phase 5) and claims (Phase 6) get tabs, progress, plan cards and timelines that work with a keyboard and a screen reader.

## In scope

Sources are `../components/{navigation,insurance}/*`; the CSS is already in `src/styles/components.css`. Each component keeps its Figma look; the changes are behaviour and semantics. Uses `.kb-sr-only` from [2.4a](04a-feedback.md).

### Navigation (`src/components/navigation/`, Figma `4:8`)

| Component | What changes from the original |
|---|---|
| `Tabs` (`9:50`) + `TabPanel` | The original has `role="tablist"` but no keyboard support. Now it follows the WAI-ARIA tabs pattern: roving `tabIndex` (only the selected tab is in the Tab order), ←/→/Home/End move and select (automatic activation), `aria-controls` ↔ `aria-labelledby` with a new `TabPanel`. `Tabs` takes an `id`, and `TabPanel` uses the same id to link up. |
| `Stepper` (`9:259`) | Done steps get hidden text ("completed") because the tick alone doesn't say it to a screen reader; current keeps `aria-current="step"`. New `label` prop names it (`<nav aria-label>` around the list; `aria-label` on the `bar` progressbar). |

### Insurance (`src/components/insurance/`, Figma `4:10`)

| Component | What changes from the original |
|---|---|
| `CoverageOption` (`14:74`) + `CoverageGroup` | The original is a `button role="radio"`, but nothing makes a set of them behave like radios. **New `CoverageGroup`** (`role="radiogroup"`, named by a label) owns the selection: roving `tabIndex`, ↑/↓/←/→ move and select, Space selects. `CoverageOption` stays the card. Features keep their tick/minus, plus hidden "Not included" text on excluded ones. |
| `Timeline` (`14:132`) | Status is only shown by colour and the node, so add hidden text per item ("Done", "In progress", "Next"); `aria-current="step"` stays on the current one. |

## Out of scope

- The mobile-only parts on the Navigation and Display pages (status bar, bottom navigation, mobile header, quote progress), built with the mobile screens (Phase 5).
- The Kerbie mark and panel (Phase 7).

## Sources

- `../components/navigation/*`, `../components/insurance/*` (`.jsx`, `.d.ts`, `.prompt.md`), their `*.card.html`.
- Figma Navigation `4:8`, Insurance `4:10` ([figma.md](../../figma.md)).
- WAI-ARIA APG: Tabs, Radio Group — https://www.w3.org/WAI/ARIA/apg/patterns/

## Files

- `src/components/navigation/{Tabs,Stepper}.tsx`, `navigation.browser.test.tsx`
- `src/components/insurance/{CoverageOption,CoverageGroup,Timeline}.tsx`, `insurance.browser.test.tsx`

## Steps

- [ ] `Timeline`, `CoverageOption`, `CoverageGroup` + tests.
- [ ] `Stepper`, `Tabs` + `TabPanel` + tests.
- [ ] Temporary page with every component and state next to Figma `4:8` and `4:10`; no console errors. Put `/` back.
- [ ] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Component | Tabs: only the selected tab is tabbable; ←/→ wrap, Home/End jump, each move selects and calls `onChange`; tab ↔ panel linked both ways; count renders | yes |
| Component | Stepper: list items in order; current has `aria-current="step"`; done steps say "completed"; `compact` hides other labels visually only; `bar` is a named progressbar with the right value and value text | yes |
| Component | CoverageGroup: radiogroup named by its label; one option tabbable; arrow keys move and select (wrapping); Space selects; `aria-checked` follows; flag, price, period and features render; excluded features say "Not included" | yes |
| Component | Timeline: items render in order; each has its status text; current has `aria-current="step"` | yes |
| Manual | Every component and state next to Figma Navigation `4:8` and Insurance `4:10` | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green.
- [ ] Manual checks pass.

## Commit message

`feat: navigation and insurance components in TSX, with keyboard support`
