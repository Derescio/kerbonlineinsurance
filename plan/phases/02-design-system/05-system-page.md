# 2.5 `/system` page

**Status:** done
**Phase:** 02-design-system

## Goal

One page that shows the whole Kerb design system as built: every token and every component in every state, laid out like the Figma pages, so it can be checked side by side with Figma (the Phase 2 payoff shot) and used as a reference while building Phases 3–8.

## In scope

- **CSP fix (found while writing this spec; Damion's call: allow style attributes).** In a production build, `style="…"` attributes from server-rendered HTML are blocked by `style-src 'self' 'nonce-…'`. Checked 30 Oct 2026: `<Wordmark size={48} />` rendered at 16 px with a CSP violation in the console. Dev has no CSP, so the 2.2–2.4 visual checks missed it. Fix: add `style-src-attr 'unsafe-inline'` in `src/server/security-headers.ts`. Style attributes can't run script, and `img-src`/`font-src 'self'` stop them loading anything off-site. `<style>` elements and stylesheets stay nonce/self-only. Update `security-headers.test.ts`: `script-src` still has no `unsafe-inline`; `style-src` still has none; only `style-src-attr` does. Note it in [engineering.md §9](../../engineering.md#9-security).
- **Route** `src/routes/system.tsx` → `/system`. Public, with `<meta name="robots" content="noindex">` so it doesn't compete with the real pages in search. Route-level code splitting keeps it out of the landing bundle.
- **Sections in Figma page order**, each with a heading, a one-line intro taken from the Figma page text, and an in-page link at the top (`#foundations`, `#icons`, …):

  | Section | Figma | Shows |
  |---|---|---|
  | Foundations | `4:2` | Colour primitives and semantic colours (swatch, token name, value), the type scale (every `.kb-*` class incl. the five added in 2.1), spacing, radii, elevation and focus |
  | Icons | `4:4` | Every icon in `icons.ts` with its id |
  | Actions | `4:5` | Button (5 variants × 3 sizes, disabled, loading, icons), IconButton (4 variants × 3 sizes) |
  | Display | `4:7` | Badge tones, Tag (toggle, selected, removable), Card variants, Wordmark |
  | Forms | `4:6` | Input (default/plate × default/focus/error/disabled, affixes, icon), Select, Checkbox, RadioGroup, Switch |
  | Feedback | `4:9` | Alert tones, Toast tones (static) plus a "Show a toast" button, Tooltip (both placements), Dialog (contained modal and sheet previews, plus buttons that open the real ones) |
  | Navigation | `4:8` | Tabs (underline, pill, with a working TabPanel), Stepper (default, compact, bar, at several steps) |
  | Insurance | `4:10` | CoverageGroup (working selection), Timeline |

- **Data-driven foundations.** The swatches and type samples come from small arrays in `src/routes/-system/foundations.ts` (token names only); the page reads each value from CSS at runtime with `getComputedStyle`, so it shows what the browser actually applies. A test checks every listed token is defined (no stale names).
- **Layout** from the Kerb tokens: `--container-max`, the spacing scale, Card for each specimen block. Readable on a phone (sections stack; wide rows wrap or scroll inside their block, never the page).
- **Focus states shown statically** where Figma shows them (Input/Select "Focus" column): a `data-demo-focus` attribute that the page's own CSS styles like `:focus-within`, scoped to `/system` only. The real components are unchanged.
- Page-specific CSS in `src/routes/-system/system.css`, imported by the route (not global).

## Out of scope

- Live props editing / a Storybook-style playground.
- The Account, Kerbie and mobile parts from Figma (built with their screens).
- E2E and axe on `/system` (the E2E job starts in 3.4; `/system` can join its axe list then).
- The Phase 2 release itself (`staging` → `main`, tag `s2-design-system`) happens after this slice merges, per [git-workflow.md](../../git-workflow.md).

## Sources

- Figma `Foundation Design` `4:2` and the six component pages (see [figma.md](../../figma.md)), including each page's intro line.
- Everything in `src/components/**` and `src/styles/**`.

## Files

- `src/routes/system.tsx`
- `src/routes/-system/{foundations.ts,sections/*.tsx,system.css}` (the `-` prefix keeps them out of TanStack Router's route tree)
- `src/routes/-system/system.browser.test.tsx`
- `src/routeTree.gen.ts` (regenerated)
- `src/server/security-headers.ts` + test, `plan/engineering.md` §9 (CSP fix)

## Steps

- [x] CSP fix + test; check `<Wordmark size={48} />` on `vp preview`.
- [x] Route, head (`title`, `noindex`), page shell with the section nav.
- [x] Foundations from `foundations.ts`; Icons from `icons.ts`.
- [x] Component sections, one file each, reusing the states from the 2.2–2.4b checks.
- [x] `data-demo-focus` styles.
- [x] Browser test (below).
- [x] Screenshot every section in Chromium at 1280 px and 390 px; compare each with its Figma page; no console errors.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`; then `vp preview` and load `/system` from a production build (CSP holds: no inline styles beyond what React sets, no violations).

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | CSP: `style-src-attr 'unsafe-inline'` present; `script-src` and `style-src` still without `unsafe-inline` | yes |
| Component | The page renders all eight sections (one `h2` each, linked from the section nav) without errors | yes |
| Component | Every token name in `foundations.ts` is defined in the loaded CSS (no empty `getPropertyValue`) | yes |
| Component | Every icon id in `icons.ts` appears on the page | yes |
| Component | The interactive demos work: "Show a toast" puts a toast in the live region; "Open dialog" opens a modal; the CoverageGroup changes selection | yes |
| Manual | `/system` next to each Figma page at 1280 px; readable at 390 px | yes |
| Manual | Production build: `/system` has no console errors or CSP violations (Wordmark at its set size), and `/` doesn't load the `/system` chunk | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green.
- [ ] Manual checks pass; Phase 2 exit criteria in [phase.md](phase.md) met.

## Results (30 Oct 2026)

Changes from the spec:
- **The page component lives in `-system/SystemPage.tsx`,** not the route file. TanStack Router warns when a route file exports anything else, because it breaks code splitting.
- **Three component CSS fixes found by checking `/system` at 390 px on a production build:**
  - **Modal wider than a phone.** The scrim's grid column sized itself to the dialog's content, so a modal could grow past a narrow screen. Now `grid-template-columns: minmax(0, 1fr)` (App additions 2.5). On a 390 px phone the real modal sits 24 px from each edge.
  - **Hidden text escaping scrollers.** `.kb-sr-only` text is `position: absolute`, so the stepper's hidden labels escaped any scroll container and widened the page (390 → 573 px). `.kb-stepper` is now `position: relative`, and so is `.sys__scroll`.
  - The tabs row on `/system` scrolls inside its block. Tabs never wrap, so **a long tab strip on a phone needs a decision when the account screens are built (Phase 6).**
- **Don't regenerate routes with `pnpm generate-routes`.** It runs the plain `tsr` CLI, which drops the TanStack Start `Register` block from `routeTree.gen.ts` and breaks the `nonce` type in `router.tsx`. `vp dev` / `vp build` regenerate it correctly. Fix or remove the script in a later chore.

What was built:
- CSP: `style-src-attr 'unsafe-inline'` (Damion's call) + tests; `engineering.md` §9 updated. Verified on `vp preview`: `<Wordmark size={36} />` renders at 36 px with no violations (it was 16 px before).
- `/system` (`src/routes/system.tsx`), with `noindex` and its own CSS and JS chunk (9.6 KB gzip; `/` doesn't load it). Sections in `src/routes/-system/sections/`; token names in `foundations.ts`, values read at runtime.
- `system.browser.test.tsx`: 4 tests (sections + nav, every token defined, every icon shown, toast/dialog/plan demos). 108 tests in total.
- Checked on a production build: no console errors or CSP violations at 1280 px and 390 px; no sideways page scroll at 390 px; every section compared with its Figma page.

## Commit message

`feat: /system page showing every Kerb token and component`
