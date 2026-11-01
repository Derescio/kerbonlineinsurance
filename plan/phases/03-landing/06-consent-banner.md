# 3.6 Consent banner

**Status:** done (approved 31 Oct 2026 as written; landed as #37)
**Phase:** 03-landing

## Goal

Ask before PostHog uses cookies or browser storage, as PECR and UK GDPR require. Until a visitor accepts, PostHog runs cookieless, so pageviews and landing events still count. Accepting turns on normal tracking and session replay. Rejecting keeps the visitor cookieless. Visitors can change their choice at any time from the footer.

This was part of 3.5. It's split out so production stops setting analytics cookies without consent before the rest of 3.5 (proxy, EU host, lazy loading, experiment) is built.

## Decisions for you

1. **Use PostHog's `cookieless_mode: "on_reject"`, not `persistence: "memory"`.** [engineering.md §13](../../engineering.md#13-analytics-and-experiments) says to start with memory persistence and switch on accept. With memory persistence, every page load looks like a brand-new visitor, so visitor and funnel counts are inflated. `on_reject` is PostHog's built-in version of the same rule. It sets no cookies or storage while consent is pending or refused, and PostHog's servers count unique visitors with a privacy-preserving daily hash. It needs one dashboard setting (below). I'd update §13 to match.
   **Trade-off:** for cookieless events, PostHog hashes the IP into the ID and then drops it, so those events get no GeoIP (country, city) and no bot filtering. Visitors who accept get both as normal. Location reports therefore cover only visitors who accept, and cookieless visitor counts may include some bots. That's a smaller loss than memory persistence's inflated counts, and Kerb is UK-only, so location tells us little.
2. **Both buttons look the same.** The ICO says rejecting must be as easy as accepting, so "Accept" and "Reject" are the same size and the same `secondary` variant, side by side. Neither is the default focus.
3. **A bar along the bottom, not a modal.** It doesn't block the page or trap focus. It's a labelled region (`<section aria-label="Cookie choices">`) that stays until the visitor chooses. The page's own CTAs keep working.
4. **Copy** (sentence case, no dark patterns):
   - "We'd like to use cookies to see how people use Kerb, so we can improve it. We won't use them unless you say yes."
   - Buttons: "Accept cookies" and "Reject cookies".
   - Link: "Cookie policy" to `/cookies`. That path already exists in `links.ts` and reaches the site 404 until 4.7 builds it, like the other unbuilt links.
5. **Footer "Cookie settings".** A button (not a link, since it doesn't go anywhere) after "Cookies" in the Support column. It clears the choice and shows the bar again.
6. **The wrapper and lazy loading stay in 3.5.** §13's `src/lib/analytics.ts` wrapper and `import()` after idle are a refactor of every call site. They're kept out to keep this slice small. The banner talks to PostHog through `usePostHog()`, like the wizard's code.

## In scope

### `ConsentBanner` (`src/components/site/ConsentBanner.tsx`)

- Rendered once in the root route, inside the PostHog provider, so it only exists where PostHog runs. Fixed to the bottom of the viewport, inside `site-container`, white card on `--shadow-3` with a 1 px `--stone-200` border and 16 px radius. On mobile it's full width and the buttons stack.
- **Rendered in the browser only.** The landing page is CDN-cached, so the server HTML is the same for everyone. The banner renders nothing on the server and on first render, then reads `posthog.get_explicit_consent_status()` after hydration. It shows only when the status is `"pending"`. This also means no layout shift in the cached HTML.
- **When PostHog isn't configured** (no env vars: local without `.env.local`, Vitest, CI), it never shows. There's nothing to consent to.
- **Accept:** `posthog.opt_in_capturing()`, then `posthog.startSessionRecording()`. The bar hides.
- **Reject:** `posthog.opt_out_capturing()`. The bar hides, and PostHog stays cookieless.
- After either choice, focus moves to the page's main landmark, so keyboard users aren't left on a removed button.
- Storing the choice itself is allowed without consent (it's strictly necessary). PostHog keeps it under its own `__ph_opt_in_out_` key.

### PostHog config (`src/routes/__root.tsx`)

- Add `cookieless_mode: "on_reject"`.
- **Fixed 31 Oct 2026 (after release):** add `opt_out_capturing_by_default: true`. On its own, `on_reject` captures nothing while the choice is pending, so visitors who ignored the bar weren't counted at all. This treats "no choice yet" as rejected: cookieless and counted. The bar still shows, because the explicit choice is still pending.
- Session replay doesn't start until consent: `disable_session_recording: true` in the init options, and the Accept handler starts it. On a return visit with consent already given, the provider starts it after init.

### Footer (`SiteFooter.tsx`, `links.ts`)

- "Cookie settings" button in the Support column, styled as a footer link. It calls `posthog.clear_opt_in_out_capturing()`, which puts consent back to pending (so PostHog is cookieless again), and the bar shows again. Hidden when PostHog isn't configured.

### Docs

- engineering.md §13: the consent bullet describes `on_reject` (decision 1).
- phase.md: add the 3.6 row; remove "consent banner" and "cookieless until consent" from 3.5; move the "no storage before consent" E2E row to 3.6.
- build-plan.md: add 3.6.

### Manual step (Damion)

- PostHog → Project settings → Web analytics → turn on **Cookieless server hash mode**. Without it, PostHog drops the cookieless events.

## Out of scope

- The `analytics.ts` wrapper, lazy loading, `/ingest` proxy, EU host and hero experiment (3.5).
- The cookie and privacy pages (4.7).
- Categories (analytics vs marketing). Kerb has one kind of optional cookie, so one yes or no is enough.

## Done when

- A fresh visit to the production build sets no PostHog cookie or `ph_` localStorage key, and still sends a cookieless `$pageview`.
- The bar shows after hydration on a fresh visit, and not on the next visit once a choice is made.
- Accept: PostHog cookie set, events and session replay start. Reject: still no cookie or storage.
- "Cookie settings" in the footer brings the bar back.
- Keyboard only: both buttons reachable and usable, focus goes to `main` after choosing, no axe serious or critical violations with the bar showing.
- `vp check`, `vp test` and `vp build` pass.

## Tests

| Layer | What | Gate? |
|---|---|---|
| Component | Banner hidden when consent isn't pending or PostHog isn't configured; shown when pending; Accept and Reject call the right PostHog methods, hide the bar and move focus to `main` | yes |
| Component | Footer "Cookie settings" clears the choice and shows the bar | yes |
| E2E | Fresh visit: no PostHog cookie or `ph_` localStorage key before a choice; after Accept, the PostHog cookie is set | yes |
| E2E (axe) | Landing with the bar showing: no serious or critical violations | yes |
| Manual | On the preview, a cookieless pageview and, after Accept, a recording show in PostHog | yes |

## Commit message

`feat: cookie consent banner, PostHog cookieless until accepted`
