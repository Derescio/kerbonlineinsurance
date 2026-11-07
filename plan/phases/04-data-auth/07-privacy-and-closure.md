# 4.7 Privacy page and account closure

**Status:** in review (built 7 Nov 2026)
**Phase:** 04-data-auth

## Goal

Anyone can leave Kerb, and Kerb never loses a record it has to keep.

- **A sign-up with nothing on file can delete their account straight away.** Their rows go, the pipeline is told (`deleted_rows`), and one audit row records that it happened.
- **A customer with insurance records closes their account instead.** A 30-day window gives them time to change their mind and Kerb time to check things. Then sign-in ends for good, while the customer, policies, claims and audit history are kept, still linked.
- **Closing an account never cancels cover.** Account closure and policy cancellation are separate processes.
- **The site says what it does with personal data.** A real privacy notice at `/privacy` names the controller and PostHog, and a `/cookies` page lists every cookie and reopens the consent bar from 3.6.

## Decisions

1. **Retention wins every conflict** (Damion, 7 Nov 2026). Document retention is paramount for audit and regulatory purposes. If deleting something would break an insurance record or the audit trail, it isn't deleted. The database's `RESTRICT` on history (4.2, decision 11) stays as the safety net.
2. **Two paths, chosen by what's on file** (Damion, 7 Nov 2026).
   - **Nothing on file:** the customer has no policy of any status, no payment of any status, and no bundle. Claims hang off policies, so no policy also means no claim. Delete is immediate.
   - **Records on file:** any policy (active, cancelled or lapsed), and with it any claim, open or closed. Also any payment (even a failed or refunded one on a quote that was never bought) or any bundle. Those are financial records, so decision 1 keeps them. `payments` and `bundles` also `RESTRICT` the delete of their quote and customer (`policies.ts`), so a delete would fail on them anyway. Closure starts a 30-day window.
3. **The window is 30 days and serves both sides** (Damion, 7 Nov 2026). The customer can sign in and cancel. Staff can review the customer's records (the tools for that come in 6.8).
4. **An open claim holds the closure until it's settled** (Damion, 7 Nov 2026). A live policy doesn't hold it. The account closes, the cover carries on, and the customer contacts Kerb about the policy.
5. **No Figma pass** (Damion, 7 Nov 2026). The screens are built straight from the copy below with the existing components.
6. **The controller is OpsEd Solutions, contact `privacy@kerb.opsedsolutions.com`** (Damion, 7 Nov 2026). Kerb is a demo brand, not a company, so the notice names the business that runs the site.
7. **Supersedes part of the plan.**
   - **4.2, decision 11** said delete account removes claims and policies explicitly. It doesn't any more: policies and claims are never deleted by a customer action.
   - **The `phase.md` row for 4.7** said `security_events` rows are deleted. That stays true on the immediate path. On closure they're kept with the closed user (call 9).

## Calls I've made (check these)

8. **Which claims are open.** `received`, `assessing` and `approved` are open, because an approved claim may still have a settlement to pay. `settled` and `declined` are closed. A `draft` claim was never submitted, so it doesn't hold the closure and is deleted when the account closes.
9. **What a closed account keeps and loses.**

   | Record | At closure |
   |---|---|
   | `users` row | **Kept**, because `customers`, `audit_log` and `security_events` point at it. `email` becomes `closed+<userId>@closed.invalid`, `name` becomes `Closed account`, `image` is cleared, `email_verified` is false |
   | `accounts` (password hash, Google link) | Deleted |
   | `sessions`, `two_factors` | Deleted |
   | `verifications` whose `value` is the user id (unused password-reset links: `reset-password:<token>`) | Deleted. Better Auth's reset would otherwise put a password back on the closed user. Email-verification links aren't stored; they fail anyway because the email has changed |
   | `idempotency_keys`, `rate_limits` rows for the user | Deleted |
   | `customers` row | **Kept unchanged.** The name, address and date of birth belong to the policy and claim records |
   | Policies, claims (not drafts), claim events, messages, settlements, payments | **Kept unchanged** |
   | Draft claims | Deleted |
   | Quotes that never became a policy and have no payment or bundle (and their items, factors, decisions) | Deleted. A quote with a payment or a bundle is kept |
   | Notifications, reviews | Deleted (no retention reason) |
   | `security_events` | **Kept** with the user row. Purging them at the end of retention is out of scope |
   | `audit_log` | **Kept**, always |

   Freeing the email has a side effect, and it's the one we want. Signing up again, or signing in with Google, under the same address creates a new, separate account. A password reset for the old address gets 4.4b's usual non-revealing answer.
10. **An illustrative retention period.** Kerb sells no real cover, so it has no real retention rules. `RETENTION` in `src/server/account/retention.ts` holds the illustrative numbers in one place: insurance records 7 years after the account closes, and security events 12 months. The privacy notice reads its table from the same constant, labelled as a demo. 4.7 stores `retain_until` on the closure. Nothing deletes anything when that date passes (out of scope).
11. **The closure lives in its own table, not on `users`.** `users` is generated by Better Auth, and a closure has a history: requested, cancelled, requested again, held, closed. New table `account_closures`:
    - **Who:** `id`, `user_id` (FK to `users`, `RESTRICT`)
    - **The window:** `requested_at`, `closes_at`
    - **How it ended:** `cancelled_at`, `held_since`, `hold_reason`, `closed_at`, `retain_until`
    - **For the watermark:** `created_at`, plus `updated_at` with the usual `set_updated_at` trigger, because rows change after insert
    - **One open closure per user:** a partial unique index on `user_id` where `cancelled_at` and `closed_at` are both null. `CHECK`s keep it to one ending (not both `cancelled_at` and `closed_at`), and `closes_at = requested_at + 30 days` is set by the server only.
    - **For the pipeline:** an entry in the data contract (copied, no personal data) and a `record_delete` trigger, like every copied table.
    - The account's state is derived from the table: an open row means `closure_requested`, a row with `closed_at` means `closed`, and no row (or only cancelled rows) means `active`. A small `getAccountState(db, userId)` in the data layer is the one place that works this out.
12. **Proving it's you.** Both paths are irreversible, so the confirm step asks for proof at the moment of confirming, not "within the last 2 hours":
    - **Password users:** the password, checked on the server against the stored hash.
    - **Google-only users:** a session signed in within the last 10 minutes, reusing 4.6's constant. Otherwise "Continue with Google" first, as on the Google version of frame 11a.
    - **2FA users, as well:** a TOTP code or a backup code entered on the confirm step. A backup code is accepted, so someone who lost their phone can still leave. The 30-day trusted-device cookie doesn't skip it.
      - **The lockout:** a wrong code counts towards 4.6's lockout, and a locked account is refused. Its helpers (`assertNotLocked`, `countFailure`, private in `two-factor.ts`) are exported for this.
      - **Where the failure is recorded:** in its own short transaction, before the write rolls back. Otherwise the rollback would erase the count.
    - **Request and cancel** go through `defineWrite` with `withIdempotency` and the shared `limit()` (5 per hour per user), so a double click acts once.
    - **The immediate delete skips `withIdempotency`.** Its key row lives in `idempotency_keys`, which cascades from `users`, so the delete would remove its own key. Instead, the transaction locks the `users` row `FOR UPDATE` first. A second request either finds the user gone (`UNAUTHENTICATED`, which the screen treats as "already deleted" and sends to `/account-deleted`) or fails the proof check. A database error is never shown. It still goes through `limit()`.
13. **Staff can't close or delete their own account.** A user with a `staff_members` row, deactivated or not, gets `STAFF_ACCOUNT` (403): "Staff accounts are closed by an admin. Ask an admin to deactivate yours." `staff_members` already refuses the delete in the database. This only gives a clear message first.
14. **The daily job.** A Vercel Cron route, `/api/cron/account-closures`, runs once a day and is protected by `CRON_SECRET` (a Bearer header; anything else gets 401). 4.11 moves it onto the jobs table later.
    - **What it picks up:** every open closure with `closes_at <= now()`.
    - **One closure at a time:** each runs in its own `withTx`, with the closure row locked `FOR UPDATE`. That way, a customer cancelling at the same moment either wins (the job finds it cancelled and skips it) or loses (the cancel finds it closed and gets `ACCOUNT_CLOSED`). One closure failing doesn't stop the others.
    - **Open claim:** if `held_since` is null, the job sets `held_since` and `hold_reason` (`claim_open:<claim reference>`), writes `account.closure_held` and sends the hold email. Otherwise it does nothing and checks again tomorrow.
    - **No open claim:** it applies call 9, sets `closed_at` and `retain_until`, and writes `account.closed`, all in one transaction.
    - **Idempotent:** a second run on the same day finds nothing new to do.
    - **Run by hand:** `vp run account:run-closures` runs the same function, for tests and manual checks. It honours `NOW=` so a run can be done "30 days later" without waiting.
15. **Audit actions** (added to `src/server/audit/actions.ts`, entity `user` for all):

    | Action | When | `changes` | Actor |
    |---|---|---|---|
    | `account.deleted` | Immediate delete, written in the same transaction, before the delete | — | the user |
    | `account.closure_requested` | Window starts | `{ closesAt }` | the user |
    | `account.closure_cancelled` | Customer keeps their account | — | the user |
    | `account.closure_held` | Day 30 with an open claim (once) | `{ reason }` | null (the job) |
    | `account.closed` | Final closure | `{ heldSince? , retainUntil }` | null (the job) |

    A held day isn't audited, only the hold starting and the closure ending (Damion, 7 Nov 2026). Audit rows hold only the user id, never the email. Because of that, the user's earlier audit rows still make sense after a delete, and the chain still verifies.
16. **Sessions.**
    - **Requesting closure:** ends every other session and keeps the current one, so the customer sees the banner.
    - **Cancelling:** changes nothing about sessions.
    - **Closing:** deletes every session.
    - **A deleted or closed user:** `getActor` returns null for them. That's defence in depth, since their sessions are gone anyway. `resolveActor` (`actor.ts`) only reads `users`, which closure keeps, so it gains a check on `account_closures` (`closed_at` set → null).
17. **The immediate delete, in one transaction:**
    1. Write `account.deleted`.
    2. Call `deleteUserFiles(tx, userId)`. It's a no-op hook in 4.7; 4.10 fills it in to remove R2 objects and `files` rows (engineering.md §6).
    3. Delete the `users` row. The cascades remove `customers`, quotes, sessions, accounts, two-factor rows, notifications and `security_events`, and `record_delete` tombstones every copied row.

    If anything throws, nothing is deleted. The "Your account has been deleted" email goes to the address read before the delete, after the commit.
18. **Emails** (Resend, after the response, as now). There are five, each short and plain:
    - **deleted**
    - **closure requested:** the date it closes, that the cover is unaffected, and "sign in before then to keep your account"
    - **closure cancelled**
    - **closure held:** "we'll close it once your claim is settled"
    - **closed:** sent to the original address, read before it's replaced. It gives `privacy@` and the policy contact.
19. **Where the entry point lives.** `/account` gains a "Close your account" section linking to `/account/close`. 6.3 moves it into Settings later.

## In scope

### Screens (built from existing components; copy below is the starting point)

- **`/account/close`, nothing on file: "Delete your account".**
  - The explanation: "This deletes your Kerb account and everything in it straight away. It can't be undone."
  - The proof fields from call 12.
  - Two buttons: "Keep my account" and "Delete my account".
  - **After deleting:** the user is signed out and lands on `/account-deleted` ("Your account has been deleted"), which links home.
- **`/account/close`, records on file: "Close your Kerb account?"**
  - **The records:** "You have insurance records we must keep", then a list of the customer's policies (product, status) and claims (reference, open or closed).
  - **Under the list:** "Closing your account doesn't cancel your cover."
  - **"What happens next"**, as a list:
    - You can still sign in for 30 days, and keep your account any time before [date].
    - Then your online access ends.
    - Your cover stays in force.
    - Policy and claim records are kept for [retention].
    - Personal details we don't need are removed.
    - To manage your policy after that, email [support].
  - **If a claim is open:** "Your account will close once claim [ref] is settled."
  - **The confirm step:** the proof fields from call 12, then the buttons "Keep my account" and "Request account closure".
- **The banner.** It shows on every signed-in page while a closure is open: "Your account closes on 7 December. [Keep my account]". When the closure is held: "Your account will close once your claim is settled. [Keep my account]". Keeping the account is one click, with no re-authentication, and the banner then confirms it.
- **The staff message** (call 13) on `/account/close` in place of the form.
- **`/privacy`:**
  - **Who we are:** Kerb is a demonstration by OpsEd Solutions, the controller. Contact `privacy@kerb.opsedsolutions.com`.
  - **What we collect and why, with the lawful basis for each:**
    - the account (contract)
    - security events: hashed IP, browser summary (legitimate interests)
    - analytics through PostHog, only after you accept (consent); the notice names PostHog and links to the cookie settings
    - emails through Resend
  - **Who processes it and where:** Vercel, Neon (London), Resend, PostHog (US), Google (sign-in) and Cloudflare (Turnstile).
  - **How long we keep it:** the table from `RETENTION`, marked illustrative.
  - **Your rights:** access, correction, erasure, restriction, objection and portability, how to ask, and a reply within a month. You can complain to the ICO.
  - **Closing your account:** a link to `/account/close`.
  - **Last updated.**
  - It's CDN-cached through `publicCacheHeaders()`, because it holds no user content (engineering.md §3.4 note).
- **`/cookies`:**
  - **The table:** every cookie the site sets (name, purpose, how long), taken from the code. That's the Better Auth session and cache cookies, the 30-day two-factor trust cookie, and PostHog's only after accepting.
  - **The button:** "Cookie settings" reopens the 3.6 bar. If PostHog isn't running, a line says so instead.
  - Also CDN-cached.

### Server

- **Database functions** live in `src/server/data/account.ts`, because the 4.5 lint rule (`vite.config.ts`) only allows database access there: `getAccountState` and the queries behind delete, request, cancel and the job.
- **The rest** lives in `src/server/account/`: `RETENTION`, the `deleteUserFiles` hook, and the orchestration (`deleteAccount`, `requestClosure`, `cancelClosure`, `runClosures(now)`). Writes go through `defineWrite`. The new error codes are `STAFF_ACCOUNT`, `ACCOUNT_CLOSED` and `CLOSURE_NOT_OPEN`, each a `PublicError`.
- The cron route, `vercel.json` with the daily cron, and the `account:run-closures` script.
- The five audit actions in `AUDIT_ACTIONS`, and the five emails.

### Schema (generated migration, plus a hand-written trigger)

- `account_closures` (call 11), with its data-contract entry and its `record_delete` trigger.

## Out of scope

- **Staff tools for the window:** seeing pending closures, placing or lifting a hold. That's 6.8. 4.7 stores what they'll need.
- **Purging at the end of retention** (deleting `security_events` after 12 months, and insurance records after `retain_until`). That needs 0004's append-only trigger to allow it, and its own slice.
- **Exporting your data** (a subject access request): by email to `privacy@` for now.
- **Stopping new quotes or purchases during the window.** Phase 5 checks `getAccountState` when buying exists.
- **Cancelling a policy.** It's a separate process and never part of closure.
- **Marketing consent:** Kerb sends no marketing and has no consent column, so there's nothing to withdraw. If marketing is ever added, closure withdraws it.
- **R2 objects:** handled by 4.10 through the `deleteUserFiles` hook.

## What you set up

- [ ] **The `privacy@kerb.opsedsolutions.com` mailbox** or a forward to your inbox, before the privacy page goes to production.
- [ ] **`CRON_SECRET`** in Vercel (Preview and Production) and `.env.local`. It's a random 32-byte value, and `.env.example` gets the name only.
- [ ] **Read the privacy notice copy** in the PR before it merges. It names you as the business, so the wording is yours to approve. This spec isn't legal advice.
- [ ] *(Optional, not blocking)* **The ICO's data protection fee self-assessment** for OpsEd Solutions.

## Steps

- [x] You approve this spec
- [x] `account_closures` migration, the data contract and the trigger
- [x] `RETENTION`, `getAccountState`, the audit actions and the error codes
- [x] `deleteAccount` (immediate path) and its tests
- [x] `requestClosure` / `cancelClosure` and `runClosures`, and their tests
- [x] The cron route, `vercel.json` and `account:run-closures`
- [x] The screens, the banner and the emails
- [x] `/privacy` and `/cookies`
- [x] Docs:
  - engineering.md §7 (account closure) and §6 (what delete account does to files)
  - the 4.2 decision 11 note
  - the `phase.md` 4.7 row and testing row
  - `build-plan.md`
- [x] `vp check`, `vp test`, `vp build`
- [ ] Your walkthrough on `dev`: delete a fresh sign-up, then close an account with fixture records (with `NOW=` 31 days on), then a staging run

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | `AUDIT_ACTIONS` snapshot updated; `RETENTION` values; the open-claim status set | yes |
| Integration | Immediate delete: the user's rows are gone (`users`, `customers`, quotes, sessions, accounts, two-factor, notifications, `security_events`), `deleted_rows` has each copied row, one `account.deleted` row, the user's earlier audit rows remain and `verifyAuditChain()` passes; `deleteUserFiles` is called once inside the transaction; a throw inside it rolls everything back | yes |
| Integration | Path choice: no policy, payment or bundle → delete; any policy (each status), a failed payment on an unbought quote, or a bundle → closure; a staff user (active or deactivated) → `STAFF_ACCOUNT` | yes |
| Integration | Proof: a wrong password, a Google session older than 10 minutes, or a missing/wrong 2FA code each refuse the action and change nothing, but the wrong code still counts towards the lockout; a backup code works; a locked account is refused; a repeat request or cancel with the same idempotency key acts once; a second delete after the first gets `UNAUTHENTICATED`, never a 500 | yes |
| Integration | Request: one open closure per user (a second request is refused); other sessions ended, current kept; `closes_at` is 30 days on | yes |
| Integration | Cancel: open → cancelled and audited; after `closed` → `ACCOUNT_CLOSED`; a later request starts a new row | yes |
| Integration | `runClosures`: before day 30 nothing happens; day 30 with no open claim closes per call 9 (each row in the table checked); with an open claim it holds once, audits once, and a second run changes nothing; after the claim settles the next run closes it; a run twice on the same day is a no-op; one failing closure doesn't stop the next | yes |
| Integration | After closure: a reset link sent before closure no longer works and puts no password back; a quote with a failed payment is still there; the old email can sign up again as a new user; password reset for it reveals nothing; `getActor` is null for the closed user; the customer, policies and settled claims still join to the user id | yes |
| Integration | Cron route: no or wrong `CRON_SECRET` → 401; right one runs `runClosures` | yes |
| Component | `/account/close` both versions (records listed, open-claim line), the proof fields, the staff message; the banner (open and held); `/cookies` with and without PostHog | yes |
| E2E | Sign up → `/account/close` → delete → signed out on `/account-deleted`, and signing in again fails; axe on `/privacy`, `/cookies`, `/account/close`, `/account-deleted` | yes |
| Manual | On `dev`: close a fixture account, run `account:run-closures` with `NOW=` 31 days on, check the rows in Neon; the five emails arrive | yes |

Integration tests that need policies and claims insert them as fixtures directly, because the product can't create them until Phases 5 and 6.

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] On staging, a fresh sign-up deletes itself and the `account.deleted` row is there, and the audit chain verifies.
- [ ] A fixture account with a settled claim closes after `account:run-closures` with `NOW=` 31 days on; one with an open claim is held.
- [ ] `/privacy` names OpsEd Solutions, `privacy@`, and PostHog, and links to the cookie settings.

## Commit message

`feat: privacy and cookies pages, immediate delete for empty accounts, and a 30-day account closure that keeps insurance records (held while a claim is open)`

## Sources

- `phase.md` 4.7 row and testing row; build-plan.md 4.7, 9.7.
- 4.2 decision 11 (`RESTRICT` on history); 4.4b (non-revealing sign-up and reset); 4.5 data-layer lint rule; 4.5b `audit()` and the chain; 4.5c `defineWrite`, `withIdempotency`, `limit()`, `PublicError`; 4.6 fresh-sign-in constant, lockout, `AUDIT_ACTIONS`.
- engineering.md §3.4 note (CDN cache and CSP nonce), §6 (files on delete), §7, §13 (consent).
- 3.1 footer links (`/privacy`, `/cookies`); 3.6 consent bar and `CookieSettings`.
- Damion, 7 Nov 2026: the two paths, the 30-day window, open claims hold, no Figma, OpsEd Solutions as controller.

## Results (7 Nov 2026, before the PR)

Changes from the spec:
- **Proof is checked in exported wrappers, not inside `defineWrite`.** `deleteAccount` and `requestClosure` take `(actor, envelope, ctx)` and call `confirmIdentity(actor, input, ctx.headers)` first, because `run` doesn't get the request headers and call 12 wants proof before the write. A rejected proof comes back in the same shape `defineWrite` returns. Cost: a retry after commit checks the proof again, so a backup code could be spent twice. `requestClosure`'s idempotency hash covers an empty object, not the password, so no unsalted password hash is kept for 24 hours.
- **`proveIdentity`** (in `confirm.ts`) also checks the session in the request belongs to the actor.
- **`resolveActor` imports `getAccountState` from `data/account` directly,** never the `data` barrel, to avoid an import cycle through `define.ts`. The barrel exports only Task 4's named functions, so the job's queries aren't in it.
- **A user with any closure row can't take the immediate path** (refused with the insurance-records message). `account_closures.user_id` stays `RESTRICT` (call 11). Not reachable today: closure needs records, and records block the delete.
- **Delete screen and `UNAUTHENTICATED`.** The spec's "already deleted" reading would have told an expired session its account was gone. The screen goes to `/account-deleted` on `UNAUTHENTICATED` only after its own earlier delete call lost its response; a first try goes to `/login?redirect=/account/close`. The delete server function clears the Better Auth session cookies (`signOut`), so the browser is really signed out.
- **The banner is also on `/account/two-factor`** and in `AccountPage` (which doesn't use `SiteLayout`); not on staff pages, because staff can't close.
- **`getClosePage` returns `closesOn`** for "keep your account any time before [date]", computed on the server so SSR and client agree.
- **Closure doesn't call `deleteUserFiles`.** Claim evidence must survive closure; which other files go is 4.10's call.
- **`runClosures` locks the `users` row before the closure row,** so it can't deadlock with a cancel. `scripts/run-closures.ts` runs the real `runClosures` (no raw-SQL copy of the audit chaining). `NOW=` only selects due closures; `closed_at` uses the database clock.
- **The privacy notice states the 12-month security-events period as an aim** and says plainly that automatic deletion isn't in place yet, because purging stays out of scope and a notice naming a real controller must not claim enforcement that doesn't exist.
- **Files:** `vercel.json` (the daily cron), `src/routes/api/cron/account-closures.ts`, `getCronSecret` in `env.ts` (an unset secret answers 500).
- **E2E needs `E2E_DATABASE_URL`** (new optional Actions secret, passed through by `e2e.yml`). The run can't open the confirmation email, so the delete test marks the new address confirmed straight in the database and skips without the secret. `/privacy` and `/cookies` response checks (Review Focus 3, ruling R5) live there too, since no integration harness renders a route response.

What was built:
- Schema: `account_closures` (`drizzle/0012_serious_virginia_dare.sql`, `0013_account_closures_triggers.sql`), data-contract entry, `app-role` grants.
- Server: `src/server/account/` (`constants`, `confirm`, `delete`, `closure`, `run-closures`, `emails`, `files`), `src/server/data/account.ts`, five audit actions, three error codes, five emails, the cron route, `vercel.json`, `vp run account:run-closures`.
- Screens: `/account/close` (delete, close, closing and staff versions), `ClosureBanner`, `/account-deleted`, the "Close your account" section on `/account`, `/privacy`, `/cookies`.
- Docs: engineering.md §7 (Account closure) and §6, 4.2 decision 11 marked superseded, `phase.md`, `build-plan.md`; the stale comment in `schema/security.ts`.

Checks (7 Nov 2026):
- `vp check`: clean.
- `vp test`: 1040 passing (76 files): 377 unit, 445 integration, 218 component. The first full run had 58 integration failures in three files (`permissions`, `two-factor`, `sessions`) while two local preview servers from the E2E run were still pointed at the same test database; those three files passed alone (148 tests) and the full run passed once the servers were idle. (`analytics.test.ts` and the feedback Toaster test, the known flakes, didn't fail.)
- `vp build`: succeeds.
- E2E (`e2e/account-close.spec.ts`, 5 tests): 5 passed against a local `vp build` and `vp preview` with Cloudflare's Turnstile test keys and the local test Postgres (`kerb_test`). It hasn't run against a deploy or `dev`: `dev` doesn't have migrations 0012 and 0013 until the PR's deploy applies them (`/account/close` answered 500 against it).

Known limits and follow-ups (all minor, deferred):
- The `data` barrel's re-export list could be narrowed further to reads.
- A purchase landing between `recordsOnFile` and the delete would hit `RESTRICT` as a 500 (no data loss); locking the `customers` row or mapping `23503` would close it.
- The cron route doesn't catch errors outside its per-closure loop, so such an error reaches the framework logger rather than `logSafeError`.
- The deleted session's cookie cache can stay usable for up to 5 minutes (same as sign out everywhere); the real session row is gone.
- Closed sessions: a sign-in or cancel queued behind the job's user lock can insert a session or `rate_limits` row for a closed user (harmless: `resolveActor` is null).
- The banner fetches once on mount, and also for anonymous visitors on public pages.
- Policy and claim rows on `/account/close` show raw enum values.
- `CLOSE_RULE` is defined in `delete.ts` and imported by `closure.ts`; it belongs beside `CLOSE_LIMIT`.
- 4.10: draft-claim evidence files need a closure-side cleanup.
- Copy written by the implementers for Damion to read in the PR: the five emails, the `/account` section, the closing-version lead, the account-deleted subtitle, and the `/privacy` text. Processor locations for Resend and Google (United States) are assumed; PostHog's one-year cookie and Better Auth's 10-minute `two_factor` cookie are library defaults, not read from our config.

Still to do (Damion):
- [ ] The `privacy@kerb.opsedsolutions.com` mailbox, `CRON_SECRET` in Vercel (Preview and Production), reading the notice, and `E2E_DATABASE_URL` in the Actions secrets.
- [ ] The walkthrough on `dev`: delete a fresh sign-up, close a fixture account, `NOW=<+31d> vp run account:run-closures`, then check Neon and the five emails.
