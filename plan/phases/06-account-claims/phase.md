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
| 6.10 | Staff claims console (designed in Figma first): `/staff/claims` queue filtered by status; claim detail with photos, documents and internal notes; status change (received → assessing → approved / declined → settled) writes a `claim_events` row, which the customer's tracker (6.6) shows; requires `claims_handler` or `admin` via the 4.5 middleware; every change audited; status moves follow the rulebook in `src/features/claims/status.ts`; `version` check refuses stale edits; status change, event and audit in one transaction; a claim status email is queued as a job. **E2E:** Playwright journey in `e2e.yml`: customer submits a claim → handler moves it to approved → customer's tracker shows it | todo |

## Recording notes

- This phase is long (10 slices). Record it in two parts: account + claims (6.1–6.6), then reviews and staff tools (6.7–6.10).

- Sources: Figma `Claims – Web/Mobile/Tablet`, `../ui_kits/web/Dashboard.jsx`, `../ui_kits/web/ClaimsJourney.jsx`, `../components/insurance/Timeline.jsx`.
- Settings screens exist so every Kerbie action in phase 7 has a matching UI.

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). Every new protected server function joins the 4.5 permission suite. `src/features/claims/status.ts` has a coverage threshold.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Integration | Dashboard, policy and claim reads return only the session user's rows (permission suite extended) | 6.1, 6.2, 6.4 | yes |
| Integration | Policy documents download only for the owner; the PDF has the policy number and dates | 6.2 | yes |
| Component | Settings: an optimistic update shows at once and rolls back with a message when the server refuses | 6.3 | yes |
| Integration | Settings changes use an idempotency key and send `private, no-store`; 2FA on/off and "sign out everywhere" work | 6.3 | yes |
| Component | Claim steps validate; photo grid stops at 10 photos and 5 PDFs, shows progress and thumbnails | 6.4, 6.5 | yes |
| Integration | Claim submit: claim + first `claim_events` row + files in one transaction; a double submit makes one claim | 6.5 | yes |
| Component | Tracker renders `claim_events` in order with the right status labels | 6.6 | yes |
| Unit | Review schema (rating 1–5, title and body lengths, tags) | 6.7 | yes |
| Component | Review form; a review body containing `<script>` renders as plain text | 6.7, 6.9 | yes |
| Integration | One review per policy; only policyholders can review; Turnstile checked on the server (test key); rate limit; idempotent submit | 6.7 | yes |
| Integration | Admin role change writes `audit_log`; customer and handler are refused the admin functions | 6.8 | yes |
| Integration | `/reviews` returns published reviews only, with `publicCacheHeaders()`; `/media/r/:fileId` returns 404 for an unpublished review's photo | 6.9 | yes |
| Unit | Claim status rulebook: every allowed move passes and every other move is refused | 6.10 | yes |
| Integration | Stale `version` refused; status + event + audit in one transaction; status email job enqueued; customer refused the staff functions | 6.10 | yes |
| E2E | Customer submits a claim → handler approves it → customer's tracker shows it | 6.10 | yes |
| E2E | Customer writes a review → admin approves it → it appears on `/reviews` | 6.9 | yes |
| E2E (axe) | Dashboard, policy detail, settings, claim steps, `/reviews`, admin and staff pages | 6.1–6.10 | yes |

## Exit criteria

- A user only ever sees their own policies and claims.
- The permission suite covers every phase-6 server function.
- Claim flow completes on the deployed URL.
- The claim → approval and review → publish Playwright journeys pass on a preview, with axe clean on every new page.
- Deployed and tagged.
