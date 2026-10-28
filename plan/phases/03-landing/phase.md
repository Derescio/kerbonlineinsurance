# Phase 3: Landing

**Tag:** `s3-landing` · **Status:** todo

## Goal

Build the landing page from the Figma split-hero design, responsive down to mobile, with the CTA leading into the quote flow.

## Payoff shot

Figma frame and live page side by side, then the browser narrowed from desktop to phone.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 3.1 | Site chrome: header and footer, plus a "Kerb is a fictional insurer made for a portfolio project. No real cover is sold." banner and footer line | todo |
| 3.2 | Split hero, with a "Retrieve my quote" link. **Perf:** hero image as AVIF/WebP responsive sizes generated at build, high priority, width/height set | todo |
| 3.3 | Landing parts: steps, trust stats (illustrative only: no invented review scores or FCA numbers), excess callout, quick actions | todo |
| 3.4 | Responsive pass against Figma. **Perf:** landing prerendered; `publicCacheHeaders()` on public pages; first `e2e.yml` Playwright smoke test on previews | todo |

## Recording notes

- Sources: Figma `Landing page – Web` frame (variants, parts, responsive variants), `templates/landing-page/LandingPage.dc.html`, `ui_kits/web/Chrome.jsx`, `assets/images/hero-*.jpg`.
- Stacked-hero variant is optional; build it only if it's cheap once the split hero exists.

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). This phase adds `e2e.yml` (Playwright against each preview) and the axe scan, in 3.4.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Component | Header: mobile menu opens and closes, traps focus, closes on Escape; demo banner and footer line always render | 3.1 | yes |
| Component | Hero: CTA and "Retrieve my quote" links point at the right routes; hero image has width, height and high priority set | 3.2 | yes |
| Component | Trust stats render the "illustrative" wording; no review score or FCA number in the markup | 3.3 | yes |
| E2E | Smoke: landing returns 200, hero CTA reaches the quote start, "Retrieve my quote" resolves, `Cache-Control` has `s-maxage` + `stale-while-revalidate` | 3.4 | yes |
| E2E (axe) | Landing at mobile and desktop widths: no serious or critical violations | 3.4 | yes |
| Manual | Figma side by side at web, tablet and mobile widths; Lighthouse accessibility ≥ 95 | 3.4 | yes |

## Exit criteria

- Landing matches Figma at web, tablet and mobile widths.
- Lighthouse accessibility ≥ 95 on the landing page.
- Smoke test and axe scan pass on the preview in `e2e.yml`.
- Deployed and tagged.
