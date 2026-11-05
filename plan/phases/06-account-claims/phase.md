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
| 6.3 | Settings: address and drivers (designed in Figma first). **Perf:** optimistic updates; account data `private, no-store`; 2FA on/off and "sign out everywhere"; each change uses an idempotency key. **`policy_versions`:** every policy change (cover level, drivers, address, premium) stores a full snapshot of the policy, numbered with `policies.version`, so "what did my policy look like on 3 March" has an answer and the data video has a history table. **Recent activity** list from `security_events` (4.4). Address, driver and 2FA changes write `audit_log` | todo |
| 6.4 | Claims overview + incident step: claims are saved as `draft` from step 1 ("Save and exit"); incident time, place, description (2,000 characters), chips and police details; third-party details in `claim_third_parties` | todo |
| 6.5 | Damage + review + submit; damage photo grid with thumbnails (up to 10) and claim documents (PDF, up to 5) using the 4.10 upload helper, both shown on the review step; submit runs in one transaction (claim + first event + files) with an idempotency key | todo |
| 6.6 | Claim tracker from `claim_events` (customer-visible rows only), the settlement card from `claim_settlements`, "Messages & documents" from `claim_messages` and `files`, and the header bell from `notifications` | todo |
| 6.7 | Reviews, write: form and card designed in Figma first; uses the `reviews` table from 4.2 (policy, customer, rating 1–5, title, body, status `pending/published/rejected`, moderation reason; one review per policy, enforced in Postgres), adding tags; editable; "Leave a review" card on the dashboard for any policyholder who hasn't reviewed; up to 3 photos per review (4.10 helper), shown in the admin queue until 7.7; review text stored and shown as plain text; Turnstile + rate limit on submit; idempotent submit | todo |
| 6.8 | Admin area: `/admin/users` (make a user a claims handler or admin by adding a `staff_members` row with a display name and staff code; **deactivate** staff: sets `deactivated_at`, revokes their sessions, returns their open claims and referrals to the queue; never deletes; all audited) and `/admin/reviews` queue with approve/reject + reason. Until 7.7, every review waits here. **`/admin/audit`:** read-only, paginated audit viewer filtered by person, action, record and date, with a "Verify chain" button (`verifyAuditChain()` from 4.5) | todo |
| 6.9 | Reviews, public: `/reviews` with average rating, count, filters by product/stars; latest reviews in the landing trust section; shown as "First name L." + "Verified Kerb demo customer". **Perf:** `/reviews` uses `publicCacheHeaders()` (5 min default, `PUBLIC_CACHE_SECONDS`); `/media/r/:fileId` streams published review photos from R2 with long immutable caching; review text rendered as plain text (no HTML) | todo |
| 6.10 | Staff claims console (decide whether drafts appear in the staff queue: `staffListClaims` and `staffGetClaim` include them today, 4.5; designed in Figma first; settlement entry writes `claim_settlements` and a `settlement_scheduled` event; replies go in `claim_messages`; internal notes are `claim_events` with `visibility = internal`): `/staff/claims` queue filtered by status; claim detail with photos, documents and internal notes; status change (received → assessing → approved / declined → settled) writes a `claim_events` row, which the customer's tracker (6.6) shows; requires `claims_handler` or `admin` via the 4.5 middleware; every change audited; opening a claim or one of its files writes a `claim.viewed` / `file.viewed` audit row (staff data functions in `src/server/data/*`, so no page can skip it); status moves follow the rulebook in `src/features/claims/status.ts`; `version` check refuses stale edits; status change, event and audit in one transaction; a claim status email is queued as a job. **E2E:** Playwright journey in `e2e.yml`: customer submits a claim → handler moves it to approved → customer's tracker shows it | todo |
| 6.11 | Staff referral queue (added 2 Nov 2026; designed in Figma first, reusing the 6.10 console shell): `/staff/referrals` lists quote items with outcome `referred`; detail shows the item's risk details and the rule that referred it; opening it writes a `referral.viewed` audit row; the handler approves (re-runs `priceQuote()` with an optional loading of 0–100%, sets `valid_until` from the decision) or declines with a reason code; each decision is an `underwriting_decisions` row + `audit_log` in one transaction, with an idempotency key; needs `claims_handler` or `admin`, 2FA and a fresh session; the customer sees the result on "Retrieve my quote", and an email is queued as a job. **E2E:** a car quote is referred → handler approves with a loading → customer buys it | todo |

## Recording notes

- This phase is long (11 slices). Record it in two parts: account + claims (6.1–6.6), then reviews and staff tools (6.7–6.11).

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
| Integration | Admin role change and staff deactivation write `audit_log`; a deactivated handler's sessions are gone and their open claims are unassigned; customer and handler are refused the admin functions, including the audit viewer | 6.8 | yes |
| Integration | A policy change writes a `policy_versions` row and bumps `version`; staff opening a claim, file or referral writes a `*.viewed` audit row; a customer viewing their own claim writes none | 6.3, 6.10, 6.11 | yes |
| Integration | `/reviews` returns published reviews only, with `publicCacheHeaders()`; `/media/r/:fileId` returns 404 for an unpublished review's photo | 6.9 | yes |
| Unit | Claim status rulebook: every allowed move passes and every other move is refused | 6.10 | yes |
| Integration | Stale `version` refused; status + event + audit in one transaction; status email job enqueued; customer refused the staff functions | 6.10 | yes |
| E2E | Customer submits a claim → handler approves it → customer's tracker shows it | 6.10 | yes |
| Integration | Referral decisions: customer refused; stale referral (already decided) refused; approve writes the decision, re-prices with the loading and audits in one transaction; double submit makes one decision | 6.11 | yes |
| E2E | Car quote referred → handler approves with a loading → customer buys it | 6.11 | yes |
| E2E | Customer writes a review → admin approves it → it appears on `/reviews` | 6.9 | yes |
| E2E (axe) | Dashboard, policy detail, settings, claim steps, `/reviews`, admin and staff pages | 6.1–6.11 | yes |

## Exit criteria

- A user only ever sees their own policies and claims.
- The permission suite covers every phase-6 server function.
- Claim flow completes on the deployed URL.
- The claim → approval and review → publish Playwright journeys pass on a preview, with axe clean on every new page.
- Deployed and tagged.
