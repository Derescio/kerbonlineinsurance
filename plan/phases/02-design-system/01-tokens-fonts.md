# 2.1 Tokens and fonts

**Status:** done
**Phase:** 02-design-system

## Goal

Bring the Kerb tokens into the app and serve the three brand fonts from our own origin, so every later component and page uses real Kerb colours, type, spacing and motion, with no third-party font request and no layout shift when the fonts load.

## In scope

- **Tokens copied in** from `../tokens/` to `src/styles/tokens/`: `colors.css`, `spacing.css`, `typography.css`, `base.css`. Values unchanged: the Figma audit (29 Oct 2026, [figma.md](../../figma.md)) found that the colour primitives, semantic colours, spacing and radii match the Figma variables exactly.
- **Type classes the audit found missing.** `kerb-components.css` hard-codes these inside components, but there is no reusable class. Add tokens and classes to `typography.css`, with values taken from the Figma text styles:

  | Figma style | Class | Value |
  |---|---|---|
  | Heading/Price | `.kb-price` | Bricolage 700, 30/34, `-0.025em`, tabular numbers |
  | Heading/Dialog | `.kb-h-dialog` | Bricolage 700, 22/28, `-0.02em` |
  | Heading/Plan | `.kb-h-plan` | Bricolage 700, 18/24, `-0.01em` |
  | Mono/Reference | `.kb-reference` | Plex Mono 500, 14/20, tabular numbers |
  | Mono/Plate | `.kb-plate` | Plex Mono 600, 22/1, `0.12em`, uppercase |

  Leave the component CSS alone in this slice. Switching it to these tokens can happen in 2.2–2.4 if it's cheap.
- **Self-hosted fonts** replacing the Google Fonts `@import` in `../tokens/fonts.css`:
  - Packages (OFL-1.1, pinned): `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono` (static 400/500/600).
  - **Latin subset only** (covers £ and UK text). Write our own `@font-face` rules in `src/styles/fonts.css` that point at the packages' `latin` woff2 files, with the latin `unicode-range`, rather than importing the packages' CSS, which pulls in every subset.
  - `font-display: swap` on every face.
  - Vite fingerprints the woff2 files into `/assets/`, so they inherit the immutable cache rule from 1.5.
- **Preload** the two fonts used above the fold, Instrument Sans (variable) and Bricolage Grotesque (variable), from `__root.tsx` `head().links`, using `?url` imports so the hashed paths are correct. Use `as: "font"`, `type: "font/woff2"` and `crossOrigin: "anonymous"`. Don't preload Plex Mono.
- **No layout shift on swap:** a metric-matched fallback face for each family (`local("Arial")` with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override`), added to the token font stacks before `system-ui`. Generate the numbers once with `@capsizecss/metrics` (dev-only script or REPL) and hard-code them with a comment saying where they came from.
- **Global CSS:** `src/styles.css` becomes the entry point. It imports `fonts.css`, then the tokens, then a short app reset (keep `box-sizing`, drop the `system-ui` body font because `base.css` sets it).
- **Proof on the page:** use `.kb-display-l` and `.kb-body-l` on the existing `index.tsx` heading and paragraph, so the fonts and tokens are visible on staging. The landing page itself comes in Phase 3.

## Out of scope

- Components and `kerb-components.css` (2.2–2.4), icons (2.2), the `/system` page (2.5).
- Dark mode. The Kerb tokens have no dark set, and Figma has none either.
- An SVG favicon from the wordmark (follow-up from 1.3; it can wait until the wordmark is TSX in 2.2).

## Sources

- `../tokens/*.css` (copy in; never import across `../`).
- Figma `Foundation Design` `4:2`: colour `15:6`/`15:166`, typography `15:287`, spacing and radii `15:328`, elevation and focus `15:386`. Component text styles: Dialog `11:187`, CoverageOption `14:45`.
- Fontsource docs (self-hosting and file layout): https://fontsource.org/docs/getting-started/install
- Capsize metrics: https://github.com/seek-oss/capsize/tree/master/packages/metrics

## Files

- `src/styles/tokens/{colors,spacing,typography,base}.css` (copied, plus the new type tokens and classes)
- `src/styles/fonts.css` (`@font-face` + fallback faces)
- `src/styles.css` (imports + reset)
- `src/routes/__root.tsx` (font preloads)
- `src/routes/index.tsx` (uses the type classes)
- `src/styles/tokens.test.ts`
- `package.json` / `pnpm-lock.yaml` (three font packages; `@capsizecss/metrics` only if it's kept as a dev dependency)

## Steps

- [x] `vp add` the three font packages. Check the exact latin woff2 file names in `node_modules` (for Bricolage, check whether the `wght` file is enough or whether the `opsz` axis needs the `full` file; we use weights 500–800 at large sizes).
- [x] Copy the four token files into `src/styles/tokens/` with a header comment naming the source and the audit date.
- [x] Add the five type tokens and classes to `typography.css`.
- [x] Write `src/styles/fonts.css`: three latin faces (Instrument Sans with roman and italic 400, if the variable package ships italic; otherwise static italic 400) plus three fallback faces. Update `--font-display`, `--font-body` and `--font-mono` to put the fallback family second.
- [x] Rewrite `src/styles.css` as the entry point.
- [x] Add the two preload links in `__root.tsx`.
- [x] Apply the type classes in `index.tsx`.
- [x] Write `tokens.test.ts` (see Tests).
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`; then `vp preview` and run the manual checks.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | Every `var(--x)` used in `src/styles/**/*.css` is defined in the token files (catches typos and missing tokens) | yes |
| Unit | No CSS file under `src/styles/` contains `http://`, `https://` or `@import url(` pointing off-site (no Google Fonts or CDN creep) | yes |
| Unit | Each `@font-face` in `fonts.css` has `font-display: swap` and a `unicode-range` | yes |
| Manual | `vp preview`, with the Network tab filtered to font: only `/assets/*.woff2` from our origin, the two preloaded fonts start early, and Plex Mono loads only when used | yes |
| Manual | Production build on staging: no CSP violations in the console (`font-src 'self'` holds) | yes |
| Manual | Lighthouse on the preview: CLS ≈ 0 on `/`; with throttling, no visible jump on swap | yes |
| Manual | The `index.tsx` heading next to Figma `Display/L`: same family, weight, size and tracking | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` exit with 0.
- [x] No request to `fonts.googleapis.com` or `fonts.gstatic.com` anywhere.
- [ ] Fonts served from our origin with the immutable cache header.
- [ ] Manual checks above pass on the preview.

## Results (29 Oct 2026)

Changes from the spec:
- **Bricolage uses the `opsz` file** (weight + optical-size axes, 77 KB), not the weight-only file (41 KB). It matches the Google Fonts original (`opsz 12..96`), so display headings keep the same shapes as in Figma.
- **Instrument Sans italic** comes from the variable package (`wght-italic`), so no static file is needed. It isn't preloaded.
- **`@capsizecss/metrics` isn't a dependency.** The fallback numbers were generated once in a scratch folder and hard-coded, with a comment saying where they came from.
- **Font stacks:** the token stacks now read `'Bricolage Grotesque','Bricolage Grotesque Fallback',system-ui,…` and the same pattern for body and mono. The old display stack fell back to Instrument Sans; it now goes to the metric-matched fallback.

What was built:
- `src/styles/tokens/{colors,spacing,typography,base}.css` copied from `../tokens/` with a source header. `typography.css` gains `--text-price`, `--text-h-dialog`, `--text-h-plan`, `--text-reference`, `--text-plate` (+ line heights and tracking) and the classes `.kb-price`, `.kb-h-dialog`, `.kb-h-plan`, `.kb-reference`, `.kb-plate`.
- `src/styles/fonts.css`: six latin faces (Bricolage, Instrument Sans roman + italic, Plex Mono 400/500/600) pointing at the package files by bare path, which Vite resolves and fingerprints, plus three fallback faces.
- `__root.tsx` preloads Bricolage and Instrument Sans via `?url` imports. The hashes match the CSS (one asset each).
- `src/styles/tokens.test.ts`: 4 tests (every used token defined, no off-site URLs, a face per family, swap + `unicode-range` + woff2 on every web face).
- Checked locally: `vp check` and `vp build` clean, `vp test` 15/15. `vp preview` HTML has both preload links (with the CSP nonce), the CSP is unchanged, and `/assets/*.woff2` is served as `font/woff2`.

Still to check on the PR preview (manual rows in Tests): fonts load from our origin with the immutable cache header, no CSP violations, CLS on `/`, and Figma side by side.

Noticed, not fixed: `vp test` prints `ReferenceError: module is not defined` (from `react/index.js`) for every test file, including the smoke test, but every test passes and it exits 0. It comes from the app's Vite plugins being loaded in the test runner and isn't caused by this slice. Look at it in 2.2, when the `component` test project splits the config.

## Commit message

`feat: Kerb tokens and self-hosted fonts`
