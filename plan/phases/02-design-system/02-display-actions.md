# 2.2 Display and action components

**Status:** done
**Phase:** 02-design-system

## Goal

Port the seven display and action components to typed TSX on top of the 2.1 tokens, switch icons to a typed, self-contained set that the CSP allows, and stand up the `component` test project (Vitest browser mode in Chromium) locally and in CI.

## In scope

- **Component CSS:** copy `../components/kerb-components.css` to `src/styles/components.css` whole, and import it from `src/styles.css` after the tokens. It's 237 lines and 2.3–2.4 need the rest of it; splitting it per component isn't worth it.
- **Components** in `src/components/`, one file each, named exports, props typed from the `.d.ts`:

  | Group | Component | Figma |
  |---|---|---|
  | display | `Icon` | Icons `4:4` |
  | display | `Badge` | `6:30` |
  | display | `Card` | `6:72` |
  | display | `Tag` | `6:54` |
  | display | `Wordmark` | `6:82` |
  | actions | `Button` | `5:306` |
  | actions | `IconButton` | `5:356` |

- **Icons: from a CDN mask to `lucide-react`.** `Icon.jsx` loads SVGs from unpkg as CSS masks, which `img-src 'self'` blocks. Replace it with:
  - `src/components/display/icons.ts`: a registry `{ "arrow-right": ArrowRight, … }` holding only the icons Kerb uses, so the bundle contains only those. `IconName` = its keys.
  - The 30 icons in Figma `Icons / Grid` `4:11`, plus the ones the UI kits and templates use (`circle-plus`, `image`, `log-out`, `user-plus`). The 16 Account-page icons and the custom `tenant`/`pet`/`condo` join when their screens are built (Phase 4/6).
  - `Icon` renders the inline SVG at `size`, with `currentColor` and `strokeWidth` 2 (Lucide default, as in Figma). It's `aria-hidden` unless `label` is given, in which case it gets `role="img"` + `aria-label`.
  - **Prop types change from `string` to `IconName`** (`Icon.name`, `Button.iconLeft/iconRight`, `IconButton.icon`, `Tag.icon`). A typo is now a type error.
- **Fixes while porting** (each one keeps the Figma look):
  - **Tag:** today a toggleable tag is a `span role="button"` with the remove `button` inside it, which nests interactive controls. Render a real `<button aria-pressed>` for toggleable tags. When a tag is removable, use a wrapper `span` with the label and a separate remove button labelled "Remove {label}".
  - **Wordmark:** `aria-label` on a plain `span` isn't reliably announced. Add `role="img"`.
  - **Card `as`:** `keyof JSX.IntrinsicElements` is deprecated under React 19 types. Narrow it to `"div" | "section" | "article" | "li" | "a"`. With `interactive` and no `as="a"`, it stays a `div` (navigation goes through a link inside; don't fake one).
  - **Button `loading`:** keep `aria-busy` and disabled. Keep the label visible so the width doesn't jump, and swap the left icon for the spinner, as the original does.
- **`cx()` helper** in `src/lib/cx.ts` (shared by every component) with a unit test.
- **`component` Vitest project:**
  - `vite.config.ts` `test.projects`: `unit` (node, `src/**/*.test.ts`) and `component` (browser mode, Playwright provider from `vite-plus/test/browser-playwright`, Chromium headless, `src/**/*.browser.test.tsx`). The component project imports `src/styles.css` in a setup file so tests see real styles.
  - Dev dependencies: `@vitest/browser-playwright` (at the bundled Vitest version, 5.0.5), `playwright`, `vitest-browser-react`, `lucide-react` (runtime dependency).
  - Look into the `ReferenceError: module is not defined` from 2.1 while splitting the config. The likely cause is TanStack Start's plugins loading in the test runner, so try giving the test projects a plugin list without `tanstackStart()`/`nitro()`. Fix it if it's cheap; otherwise write down what was found.
- **CI:** in `ci.yml`, before `vp test`, install Chromium (`vp exec playwright install --with-deps chromium`), with the browser cache keyed on the Playwright version ([engineering.md §4](../../engineering.md#4-ci-github-actions)).

## Out of scope

- Form, feedback, navigation and insurance components (2.3, 2.4); the `/system` page (2.5).
- Visual regression screenshots. The Figma comparison stays manual (engineering.md §4).
- Moving component CSS hard-coded values onto the new 2.1 type tokens, unless a component touched here makes it trivial.

## Sources

- `../components/actions/*` and `../components/display/*` (`.jsx`, `.d.ts`, `.prompt.md` for usage rules such as "one accent per view"), `../components/kerb-components.css`, `../components/{actions,display}.card.html`.
- Figma: Actions `4:5`, Display `4:7`, Icons `4:4` (see [figma.md](../../figma.md)).
- Vitest browser mode: https://vitest.dev/guide/browser/ · Vite+ migrate notes: `node_modules/vite-plus/docs/guide/migrate.md` (browser providers).
- Lucide React: https://lucide.dev/guide/packages/lucide-react

## Files

- `src/styles/components.css`, `src/styles.css`
- `src/lib/cx.ts`, `src/lib/cx.test.ts`
- `src/components/display/{Icon,icons,Badge,Card,Tag,Wordmark}.tsx|ts`
- `src/components/actions/{Button,IconButton}.tsx`
- `src/components/**/*.browser.test.tsx`
- `src/test/setup.browser.ts`
- `vite.config.ts` (test projects), `.github/workflows/ci.yml` (Chromium step), `package.json`, `pnpm-lock.yaml`

## Steps

- [x] Add the dependencies. Split `vite.config.ts` into the `unit` and `component` projects, and check that the existing unit tests still run under `unit`.
- [x] One throwaway browser test that renders a `<button>`, to prove Chromium runs locally. Then look into the `ReferenceError`.
- [x] Copy `components.css` and import it.
- [x] `cx` + test.
- [x] `icons.ts` registry + `Icon`.
- [x] `Badge`, `Card`, `Wordmark`, then `Tag`, then `Button`, `IconButton`, each with its browser test.
- [ ] Chromium step in `ci.yml`; push and see `ci` go green with the browser tests running.
- [x] Temporarily render every component on `/` (or a scratch route), check it against Figma, then put `/` back. `/system` is 2.5.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | `cx` drops falsy values and joins with single spaces | yes |
| Component | `Icon`: renders an SVG at `size`; `aria-hidden` without a label; `role="img"` + name with a label | yes |
| Component | `Badge`: each tone sets its modifier class; `dot` renders a hidden dot | yes |
| Component | `Card`: each variant and padding class; `as` changes the element; `interactive` adds the class | yes |
| Component | `Wordmark`: accessible name "Kerb"; `inverse` tone class; descriptor text shown but not read twice | yes |
| Component | `Tag`: toggleable tag is a button with `aria-pressed` that flips on click, Enter and Space; remove button has the name "Remove {label}", fires `onRemove` once and doesn't toggle | yes |
| Component | `Button`: each variant and size class; click fires once; disabled and loading don't fire; loading sets `aria-busy` and shows the spinner; `type` defaults to `button` | yes |
| Component | `IconButton`: accessible name from `label`; each variant and size; disabled doesn't fire | yes |
| Component | Keyboard: Button, IconButton and Tag are reachable with Tab and show a visible focus ring (non-`none` `box-shadow` on `:focus-visible`) | yes |
| Manual | Every component and state next to Figma Actions `4:5` and Display `4:7` | yes |
| Manual | Production preview: icons render, no CSP violations, no request to unpkg | yes |

## Done when

- [x] `vp check`, `vp test` (unit + component) and `vp build` exit with 0 locally.
- [ ] `ci` runs the component tests in Chromium and passes.
- [x] No CDN icon URL left in `src/`.
- [ ] Manual checks pass on the PR preview.

## Results (29 Oct 2026)

Changes from the spec:
- **Tests grouped by folder:** `display.browser.test.tsx` and `actions.browser.test.tsx` instead of one file per component. Same coverage: 45 component tests.
- **Tag** has three shapes: toggle (`<button aria-pressed>`), removable (label + its own "Remove {label}" button) and static. A removable tag can still show `selected` (Figma has a selected "Rear-ended" chip with ×). Three small rules at the end of `components.css` (marked "App additions") give the non-clickable wrapper a default cursor, keep the selected border on hover, and give the remove button a focus ring.
- **Wordmark** name includes the descriptor ("Kerb car insurance") rather than always "Kerb".

What we learned about testing with Vite+:
- **The 2.1 `ReferenceError` is fixed.** In Vitest 5, inline projects inherit the root config, and the root test server loads the root plugins whatever the projects say. TanStack Start and Nitro in the test runner caused the error. Fix: `extends: false` on both projects, and the root plugin list is empty when `process.env.VITEST` is set (`appPlugins()` in `vite.config.ts`).
- **Duplicate React in browser tests:** found late, `lucide-react` got its own pre-bundled React and hooks failed (`useContext` of null). Fix: `optimizeDeps.include` on the `component` project.

What was built:
- `src/styles/components.css` (copied, then expanded by the formatter) imported from `src/styles.css`.
- `src/lib/cx.ts` + 3 unit tests.
- `src/components/display/{icons.ts,Icon,Badge,Card,Tag,Wordmark}.tsx`, `src/components/actions/{Button,IconButton}.tsx`. `icons.ts` holds 34 Lucide icons; `IconName` is typed from it.
- `vite.config.ts`: `unit` and `component` projects (Chromium headless via `vite-plus/test/browser-playwright`), setup file `src/test/setup.browser.ts` loading the real CSS.
- `ci.yml`: Playwright version → `actions/cache` (v6.1.0, pinned by SHA) of `~/.cache/ms-playwright` → install Chromium (or only its system deps on a cache hit) → `vp test`.
- `.gitignore`: `.vitest/` (failure screenshots).
- Checked locally: 60/60 tests (15 unit, 45 component) twice in a row; `vp check` and `vp build` clean; no CDN icon URL in `src/`. A temporary page with every component and state, screenshotted in Chromium, matches Figma Actions `5:306` and Display `4:7` (colours, radii, sizes, disabled states, badge tones, card variants, wordmark); no console errors. `/` was put back afterwards.

Still to check on the PR preview: `ci` runs the component tests in Chromium; icons render in a production build with no CSP violations.

## Commit message

`feat: display and action components in TSX, with browser tests`
