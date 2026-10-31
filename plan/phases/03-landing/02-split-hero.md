# 3.2 Split hero

**Status:** in-progress (approved 31 Oct 2026; built, waiting for PR)
**Phase:** 03-landing

## Goal

Build the evergreen split hero from Figma (copy and postcode quote form on the left, home-and-car photo on the right), with the photo served as responsive AVIF/WebP and loaded as the page's high-priority LCP image.

## In scope

### `Hero` (`src/features/landing/Hero.tsx`, Figma `54:1952` web, `88:2274` tablet, `88:2542` mobile)

- Full-bleed `--green-900` band straight under the header, with 24 px rounded bottom corners. Content in the 1152 px `site-container`, 72 px top and bottom padding on web.
- **Copy:** overline "Online insurance" (mono 13/16, Marker 400); `<h1>` "Kerb Online Insurance." (Bricolage 800, 68/69 px on web, `clamp()` down to about 44 px on mobile, −0.035 em); intro (19/30, white 78 %), as in Figma.
- **Quote form** (white card, 20 px padding, 16 px radius, `--shadow-3`):
  - `Input` "Your postcode", `map-pin` icon, placeholder "e.g. E8 3RL", `name="postcode"`, `autoComplete="postal-code"`, `autoCapitalize="characters"`, `spellCheck={false}`.
  - `Button` accent lg "Get a quote" + `arrow-right`, `type="submit"`. This is the page's one accent button.
  - Note row: "Takes about two minutes. No account needed." and the saved-quote link.
- **Layout:** two columns on web and tablet (photo 440 px tall on web, 360 px on tablet); one column on mobile, the photo below the form (220 px tall), the note row stacking its two lines as in `88:2543`.

### How the form works

- A real `<form method="get" action="/quote">`, so it works before hydration and without JS.
- With JS, submit checks the postcode first. Invalid: stop, show "Enter your full postcode, like E8 3RL." on the field (`Input` already wires `aria-invalid` and `aria-describedby`), and move focus to it. Valid: the browser submits `/quote?postcode=E8+3RL` (normalised: upper case, one space). The error clears as soon as the field is edited.
- `/quote` and the saved-quote page don't exist until Phase 5, so for now both reach the site 404, as agreed for every unbuilt path. Phase 5 replaces the native submit with a router navigation.
- **Postcode check:** `src/features/quote/postcode.ts`, `normalisePostcode(input): string | null` plus a zod `postcodeSchema` built on it, so Phase 5's server validation reuses the same rule. UK format only (outward + inward code); it doesn't check that the postcode exists.

### Saved-quote link: copy decision

The plan calls it "Retrieve my quote"; Figma says **"Continue a saved quote"** (in the hero and again in the closing CTA card). I'll follow Figma, because it's the wording the side by side is checked against, and update the phase test row to match. Say if you'd rather keep "Retrieve my quote". Path: `/quote/retrieve`, added to `links.ts` next to `/quote`.

### Hero image (Perf)

- Source: `../assets/images/hero-home-and-car-evening.jpg` (2400 × 1340), copied to `src/assets/hero-home-and-car-evening.jpg`. It's the exact image in the Figma frame.
- **`vite-imagetools`** (new dev dependency) generates the sizes at build: widths 480, 768, 1152 and 1600, as AVIF and WebP, plus a JPEG fallback, imported with `?as=picture`. Every output is a hashed file under `/assets`, so it's served from our own origin (the CSP's `img-src 'self'` is unchanged) and cached as immutable.
- `<picture>` with `sizes="(min-width: 768px) 50vw, 100vw"`, `width`/`height` set from the source, `fetchpriority="high"`, `loading="eager"`, `decoding="async"`, and `object-fit: cover` to fill each breakpoint's crop without layout shift.
- `alt=""`: the photo is decorative (it carries no information the copy doesn't).
- Small `HeroImage` wrapper so the import and attributes live in one place and the test can check them.

## Out of scope

- Excess callout, trust stats, accordion, how it works, quick actions, the closing CTA card (3.3).
- Prerendering, cache headers and the e2e smoke test (3.4).
- Plate lookup in the hero (the quote flow, Phase 5); the stacked-hero variant.
- The hero-CTA copy experiment (3.5). The CTA keeps a fixed size, so 3.5 can swap its label without layout shift.

## Sources

- Figma `Hero — Split` `54:1952` (web), `88:2274` (tablet), `88:2542` (mobile).
- `../templates/landing-page/LandingPage.dc.html` (split hero markup, postcode regex and error copy).
- `../assets/images/hero-home-and-car-evening.jpg`.
- Phase 2 parts: `Input`, `Button`; 3.1: `site-container`, `links.ts`.
- vite-imagetools: https://github.com/JonasKruckenberg/imagetools

## Files

- New: `src/features/landing/{Hero,HeroImage}.tsx`, `src/features/landing/landing.css`, `src/features/landing/hero.browser.test.tsx`, `src/features/quote/postcode.ts`, `src/features/quote/postcode.test.ts`, `src/assets/hero-home-and-car-evening.jpg`, an `imagetools` type declaration.
- Changed: `src/routes/_site/index.tsx` (renders `Hero`, placeholder removed), `src/components/site/links.ts` (`quoteHref`, `retrieveQuoteLink`), `vite.config.ts` (imagetools in the app plugins and the component test project), `package.json`, `src/styles.css` (import `landing.css`), `plan/phases/03-landing/phase.md` (test row wording).

## Steps

- [x] `postcode.ts` test-first (valid, lower case, missing or extra spaces, invalid, empty).
- [x] `vite-imagetools` + `HeroImage`; check the build emits AVIF/WebP/JPEG at each width.
- [x] `Hero` + form behaviour + tests.
- [x] Landing route renders the hero.
- [x] Side by side with Figma at 1440, 1024 and 390 px (I'll say before running the headless browser); check the LCP element is the hero image and nothing shifts as it loads.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | `normalisePostcode`: "e83rl" → "E8 3RL", "SW1A 1AA" and "  sw1a1aa " → "SW1A 1AA", "M1 1AE" ok; "E8", "123", "" and "ABCDEFG" → null; `postcodeSchema` gives the error copy | yes |
| Component | Hero: `h1` reads "Kerb Online Insurance."; the form is GET `/quote` with a labelled postcode field; "Continue a saved quote" points at `/quote/retrieve` | yes |
| Component | Form: an invalid postcode blocks submit, shows the error linked by `aria-describedby`, marks the field invalid and focuses it; editing clears the error; a valid one submits with the normalised value | yes |
| Component | Hero image: `width`, `height`, `fetchpriority="high"`, `loading="eager"`; AVIF and WebP `<source>`s with a `srcset` of several widths | yes |
| E2E | none yet: `e2e.yml` arrives in 3.4 | — |
| Manual | Hero next to Figma at web, tablet and mobile; LCP element is the hero image; image requests are AVIF in Chromium | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green on the PR.
- [ ] Manual checks pass.

## Results (31 Oct 2026)

Changes from the spec:
- **`HeroImage` takes the crop from CSS:** the `<picture>` is the box (440 / 360 / 220 px tall per breakpoint) and the image fills it with `object-fit: cover`. The `<img>` carries the source's own width and height for the aspect ratio.
- **The button doesn't bottom-align with the input**; it sits 22 px down (label + gap + input − button). Bottom alignment would have pushed it down whenever the error message shows.
- `src/imagetools.d.ts` types the `&as=picture` import (vite-imagetools ships no types for it). The plugin is also in the `component` test project, so tests import the real image.
- For 3.4: at 390 px the postcode error wraps in the narrow column beside the button (readable, but three lines).

What was built:
- `src/features/landing/{Hero,HeroImage}.tsx`, `landing.css`; `src/features/quote/postcode.ts`; `src/assets/hero-home-and-car-evening.jpg`; `quoteHref` and `retrieveQuoteLink` in `links.ts`; `vite-imagetools` 12.0.1 (dev).
- Tests: `postcode.test.ts` (4) and `hero.browser.test.tsx` (4): 130 in total, all passing first time. `vp check` and `vp build` clean.
- Build output: 12 hero files (AVIF, WebP, JPEG at 480, 768, 1152 and 1600 px). AVIF is 12 kB at 480 px and 74 kB at 1152 px, against 498 kB for the source JPEG.
- Headless check on the production build: at 1440, 1024 and 390 px the LCP element is the hero `<img>`, served as AVIF, with CLS 0. The layout matches Figma `54:1952`, `88:2274` and `88:2542`. An invalid postcode shows the error and focuses the field; "e83rl" submits `/quote?postcode=E8+3RL` (404 until Phase 5, as agreed).

## Commit message

`feat: split hero with postcode quote form and responsive AVIF/WebP hero image`
