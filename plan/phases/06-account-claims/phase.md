# Phase 6: Account and claims

**Tag:** `s6-account-claims` · **Status:** todo

## Goal

The signed-in side: dashboard, policy detail, settings (address and drivers), and the full claims journey with a live tracker.

## Payoff shot

File a claim, then watch it appear on the dashboard and in the tracker timeline.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 6.1 | Dashboard | todo |
| 6.2 | Policy detail, with downloadable documents (certificate of insurance, policy schedule) | todo |
| 6.3 | Settings: address and drivers (designed in Figma first). **Perf:** optimistic updates; account data `private, no-store`; 2FA on/off and "sign out everywhere"; each change uses an idempotency key | todo |
| 6.4 | Claims overview + incident step | todo |
| 6.5 | Damage + review + submit; damage photo grid with thumbnails (up to 10) and claim documents (PDF, up to 5) using the 4.10 upload helper, both shown on the review step; submit runs in one transaction (claim + first event + files) with an idempotency key | todo |
| 6.6 | Claim tracker from `claim_events` | todo |
| 6.7 | Reviews, write: form and card designed in Figma first; `reviews` table (user, policy, product, rating 1–5, title, body, tags, status `pending/published/rejected`, moderation reason); one review per policy, editable; "Leave a review" card on the dashboard for any policyholder who hasn't reviewed; up to 3 photos per review (4.10 helper), shown in the admin queue until 7.7; review text stored and shown as plain text; Turnstile + rate limit on submit; idempotent submit | todo |
| 6.8 | Admin area: `/admin/users` (assign claims handlers, audited) and `/admin/reviews` queue with approve/reject + reason. Until 7.7, every review waits here | todo |
| 6.9 | Reviews, public: `/reviews` with average rating, count, filters by product/stars; latest reviews in the landing trust section; shown as "First name L." + "Verified Kerb demo customer". **Perf:** `/reviews` uses `publicCacheHeaders()` (5 min default, `PUBLIC_CACHE_SECONDS`); `/media/r/:fileId` streams published review photos from R2 with long immutable caching; review text rendered as plain text (no HTML) | todo |
| 6.10 | Staff claims console (designed in Figma first): `/staff/claims` queue filtered by status; claim detail with photos, documents and internal notes; status change (received → assessing → approved / declined → settled) writes a `claim_events` row, which the customer's tracker (6.6) shows; requires `claims_handler` or `admin` via the 4.5 middleware; every change audited; status moves follow the rulebook in `src/features/claims/status.ts`; `version` check refuses stale edits; status change, event and audit in one transaction; a claim status email is queued as a job | todo |

## Recording notes

- This phase is long (10 slices). Record it in two parts: account + claims (6.1–6.6), then reviews and staff tools (6.7–6.10).

- Sources: Figma `Claims – Web/Mobile/Tablet`, `../ui_kits/web/Dashboard.jsx`, `../ui_kits/web/ClaimsJourney.jsx`, `../components/insurance/Timeline.jsx`.
- Settings screens exist so every Kerbie action in phase 7 has a matching UI.

## Exit criteria

- A user only ever sees their own policies and claims.
- Claim flow completes on the deployed URL.
- Deployed and tagged.
