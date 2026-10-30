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
| 3.5 | PostHog + first experiment ([engineering.md §13](../../engineering.md#13-analytics-and-experiments)): installed with the PostHog wizard, then fixed up by hand (same-origin `/ingest` proxy, EU host, lazy-loaded, cookieless until consent, consent banner). Pageviews and key landing events. A flag-driven hero-CTA copy experiment | todo |

## Recording notes

- Sources: Figma `Landing page – Web` frame (variants, parts, responsive variants), `templates/landing-page/LandingPage.dc.html`, `ui_kits/web/Chrome.jsx`, `assets/images/hero-*.jpg`.
- Stacked-hero variant is optional; build it only if it's cheap once the split hero exists.
- 3.5: show the wizard's diff, then why each fix-up is needed: the CSP blocks PostHog in a production build, the cached landing page can't pick variants on the server, and the consent rules.

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
| E2E | Production build with PostHog loaded: no CSP violations (listen for `securitypolicyviolation`); PostHog requests go to `/ingest` only | 3.5 | yes |
| E2E | No PostHog cookie or localStorage key before consent; after accepting, events reach `/ingest` | 3.5 | yes |
| Component | Each hero-CTA variant renders; the control renders when flags fail or time out | 3.5 | yes |
| Manual | Experiment and events show in the PostHog dashboard from a preview; CLS unchanged and landing JS still < 150 KB gzip in Lighthouse | 3.5 | yes |

## Exit criteria

- Landing matches Figma at web, tablet and mobile widths.
- Lighthouse accessibility ≥ 95 on the landing page.
- Smoke test and axe scan pass on the preview in `e2e.yml`.
- PostHog runs on the preview with no CSP violations, no storage before consent, and the first experiment live.
- Deployed and tagged.
