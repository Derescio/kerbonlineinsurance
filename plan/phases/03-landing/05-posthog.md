# 3.5 PostHog + first experiment

**Status:** in progress. Approved 31 Oct 2026 with decision 3 option A. Part 1 done (#41); Part 2 next.
**Phase:** 03-landing

## Goal

Finish the PostHog setup that #36 (wizard install, CSP, replay masking), #37 (consent, 3.6) and #39 (pending visitors counted, postcode masking) started. PostHog requests go through the site's own domain, PostHog loads after the page is interactive and stays out of the landing JS budget, every call goes through one wrapper, and the hero CTA gets its first A/B test.

## Where things stand (31 Oct 2026)

- Landing JS is **216 KB gzip** in the main chunk. It was **110 KB** before PostHog (`20aed6f`), so PostHog adds about 106 KB. The budget is 150 KB ([engineering.md §5](../../engineering.md)).
- Requests go to `us.i.posthog.com` and `us-assets.i.posthog.com`. Tracker blocklists include both, so some phones and privacy browsers send nothing.
- Six files import PostHog directly: `__root.tsx`, `consent.ts`, `Hero.tsx`, `InsuranceTypes.tsx`, `ClosingCta.tsx`, `QuickActions.tsx`.

## Decisions for you

1. **Keep the US region** (Damion, 31 Oct 2026). It's a portfolio project, so the EU move in §13 isn't worth losing the current data and dashboard. A client in the EU would get an EU project, set up by hand. §13 is updated to say so.
2. **Build it as two PRs.** Part 1 is plumbing with no visible change: proxy, wrapper, lazy loading. Part 2 is the experiment. Each is small enough to check on its own preview.
3. **Who the experiment covers.** PostHog evaluates feature flags per visitor ID. Before a visitor accepts cookies, every visitor shares one placeholder ID (`$posthog_cookieless`), so a flag would give all of them the same variant. Options:
   - **A. Visitors who accepted only (recommended; chosen 31 Oct 2026).** Uses PostHog's Experiments feature as intended: flag, exposure, results with significance. Cookieless visitors always see the control and are left out of the results. The sample is smaller, but it's a portfolio demo of the real tooling.
   - **B. Everyone, split in the browser.** Each page load picks a variant at random in memory (nothing stored, so no consent needed) and sends it as an event property. Results come from an ordinary insight, not the Experiments feature, and there's no significance calculation.
4. **The variants.** Control "Get a quote", test "See my price" on the hero button. The words are about the same width, and the button gets a `min-width` that fits both, so the swap can't shift the layout.
5. **Drop the wizard's log lines.** `Hero.tsx` and `InsuranceTypes.tsx` send a PostHog log record next to each event (`quote started from landing page` alongside `quote_started`), so they duplicate the events. The wrapper has `track` only. The validation warning in the hero ("blocked by postcode validation") becomes an event, `quote_start_blocked`, so it's countable.

## Part 1: proxy, wrapper, lazy loading

### Same-origin proxy

- Nitro route rules in `vite.config.ts`. The Vercel preset turns them into Vercel rewrites:
  - `/ingest/static/**` and `/ingest/array/**` → `https://us-assets.i.posthog.com/…`
  - `/ingest/**` → `https://us.i.posthog.com/…`
- `api_host: "/ingest"`, `ui_host: "https://us.posthog.com"` (the toolbar and links back to the app). `VITE_PUBLIC_POSTHOG_HOST` stays the PostHog host and is no longer used for requests, so Vercel needs no change.
- The CSP drops the PostHog hosts: `posthogOrigins("/ingest")` already returns nothing for a same-origin path, so `script-src` and `connect-src` go back to `'self'`.
- **Risk to check:** cookieless IDs and GeoIP come from the visitor's IP. The rewrite has to pass the visitor's IP through (`X-Forwarded-For`), or every visitor collapses into Vercel's few addresses. Done when lists the check.

### One wrapper: `src/lib/analytics.ts`

- `track(event, properties)`, `getFlag(key)` (Part 2), and the consent calls (`consentStatus`, `acceptCookies`, `rejectCookies`, `reopenConsent`, `onConsentChange`). The PostHog options move here from `__root.tsx`.
- Components never import PostHog. `useConsent()` in `consent.ts` reads the wrapper.
- `@posthog/react` is removed: its provider and hooks import posthog-js up front, which is what puts it in the main chunk. `PostHogErrorBoundary` is replaced by a small boundary that reports through the wrapper. `capture_exceptions` still catches uncaught errors and rejections.
- When PostHog isn't configured (no env vars: local without `.env.local`, Vitest, CI) every call is a no-op, so tests send nothing.

### Lazy loading

- The wrapper loads posthog-js with a dynamic `import()` after hydration, in `requestIdleCallback` (`setTimeout` fallback). `track` calls made before it loads are queued and sent once it does.
- The consent bar still appears only after PostHog loads, as now.

## Part 2: hero CTA experiment

- PostHog: an experiment on flag `hero-cta-copy` (control / `see-my-price`), primary metric `quote_started`. Damion creates it in the dashboard; the spec names the keys.
- `Hero` renders the control in the server HTML. After PostHog loads, `getFlag("hero-cta-copy")` may swap the label. If flags don't arrive within 1.5 s, or fail, it stays the control.
- Decision 3 sets who's included. With A, the hero asks for the flag only when consent is `granted`.

## Out of scope

- The EU project (decision 1).
- Server-side flags with `posthog-node` (Phase 5, SSR routes).
- Source-map upload for error stacks (wizard follow-up; later, with the CI deploy work).

## Manual steps (Damion)

- Part 2: create the `hero-cta-copy` experiment in PostHog with the variants above.

## Done when

Part 1:

- Main client chunk back under **150 KB gzip**; posthog-js in its own lazy chunk.
- All PostHog requests go to `/ingest` on the site's domain; the CSP has no PostHog hosts and the browser reports no violations.
- Events still arrive in PostHog from a preview, with the visitor's real IP (two networks give two different cookieless IDs; GeoIP filled in for accepted visitors).
- No component imports `posthog-js` or `@posthog/react` (lint rule or a test that greps).
- Consent flow and postcode masking behave as before (existing tests pass).

Part 2:

- The hero shows the control without JS and before flags load; each variant renders; flags failing or timing out leaves the control; no layout shift.
- The experiment shows exposures in PostHog from a preview.

## Tests

| Layer | What | Part | Gate? |
|---|---|---|---|
| Unit | Wrapper: no-op when unconfigured; queues `track` before load and flushes after | 1 | yes |
| E2E | Production build with PostHog loaded: no CSP violations; every PostHog request goes to `/ingest` | 1 | yes |
| E2E | Existing consent tests still pass through the proxy | 1 | yes |
| Component | Each hero-CTA variant renders; the control renders when flags fail or time out | 2 | yes |
| Manual | Preview: events and the experiment in PostHog; Lighthouse CLS unchanged; landing JS < 150 KB gzip | 1, 2 | yes |

## Commit messages

- Part 1: `feat: PostHog through a same-origin proxy, loaded lazily behind one analytics wrapper`
- Part 2: `feat: hero CTA copy experiment`
