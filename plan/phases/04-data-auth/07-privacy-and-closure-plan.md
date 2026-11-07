# 4.7 Privacy page and account closure: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Someone with nothing on file can delete their account straight away. Someone with insurance records gets a 30-day closure, held while a claim is open, that keeps every record Kerb must retain. `/privacy` and `/cookies` say what the site does with personal data.

**Architecture:**
- **One table, one state function.**
  - **The table:** `account_closures` (spec call 11) holds the closure history.
  - **The state function:** `getAccountState(db, userId)` in `src/server/data/account.ts` is the only place that turns those rows into `active | closure_requested | closed`.
- **Where the code lives:**
  - **Database access** stays in `src/server/data/account.ts`, which the 4.5 lint rule allows.
  - **Orchestration** lives in `src/server/account/`: `RETENTION`, `deleteUserFiles`, delete, request, cancel and the daily run.
- **Every change and its audit row share one `withTx`.** The emails go after the commit through the auth deps' `sendEmail` and `defer` (as `auth.ts` does).
- **Proof of identity uses Better Auth's own endpoints** with the request headers:
  - the password: `auth.api.verifyPassword`
  - the 2FA code: `auth.api.verifyTOTP` and `auth.api.verifyBackupCode`

  The code checks happen before our transaction, so `kerbTwoFactor()`'s signed-in hooks apply 4.6's lockout, and its count isn't rolled back.
- **The daily job** is a server route, `src/routes/api/cron/account-closures.ts`, scheduled in a new `vercel.json`. The same `runClosures(db, now)` also runs from `scripts/run-closures.ts`.

**Tech Stack:** Better Auth 1.7.15, TanStack Start 1.169, Drizzle 0.45 + node-postgres, zod 4.6, Postgres 18 (Docker on `localhost:5433`), Vitest via `vite-plus/test` (`unit`, `integration`, `component`), Playwright + axe for E2E, Resend.

**Spec:** [07-privacy-and-closure.md](07-privacy-and-closure.md) (approved 7 Nov 2026). Read it first. Call numbers below are the spec's.

## Global Constraints

- **Branch and PR:**
  - Work in the main folder on `feat/4.7-privacy-and-closure` (from `staging`). No worktree.
  - One commit per task (Conventional Commits), ending with the `Co-Authored-By` trailer.
  - Nothing is pushed until Damion says so. The PR goes into `staging` and is squash-merged with the spec's commit message.
- **Numbers (one place each, `src/server/account/constants.ts`, which imports nothing):**
  - `CLOSURE_WINDOW_DAYS = 30`
  - `RETENTION = { insuranceRecordsYears: 7, securityEventsMonths: 12 } as const`, labelled illustrative
  - `CLOSE_LIMIT = { window: 60 * 60, max: 5 }` (seconds), for request, cancel and delete
  - the Google freshness check reuses `PASSWORDLESS_FRESH_MS` from `two-factor-constants.ts`
- **Open claim statuses (call 8):** `["received", "assessing", "approved"]`. Drafts are discarded at closure; `settled` and `declined` are closed.
- **"Records on file" (decision 2):** the user's customer row has any `policies`, `payments` or `bundles` row.
- **The scrubbed user (call 9):** `email = closed+<userId>@closed.invalid`, `name = "Closed account"`, `image = null`, `email_verified = false`.
- **Error codes (added to `AuthzCode`, fixed sentences verbatim):**
  - `STAFF_ACCOUNT` (403): "Staff accounts are closed by an admin. Ask an admin to deactivate yours."
  - `ACCOUNT_CLOSED` (403): "This account is closed."
  - `CLOSURE_NOT_OPEN` (404): "There's no account closure to cancel."
- **Proof failures** are `rejected()` with field errors, never thrown:
  - `password`: "That password isn't right."
  - `code`: "That code isn't right."
  - Google too old: message "Sign in with Google again to confirm it's you." with no field
- **Audit actions (call 15), entity `user`:**
  - `account.deleted`
  - `account.closure_requested`
  - `account.closure_cancelled`
  - `account.closure_held`
  - `account.closed`
- **Controller and contact (decision 6):** OpsEd Solutions, `privacy@kerb.opsedsolutions.com`.
- **Logs:** ids and codes only, never emails, passwords or codes. Unexpected errors go through `logSafeError`.
- **Tests:**
  - Imports come from `vite-plus/test`.
  - Integration tests call `truncateAll()` in `beforeEach` and build records with `src/test/factories.ts` (`makeUser`, `makeCustomer`, `makeQuote`, `makePolicy`, `makePayment`, `makeClaim`, `makeStaff`).
  - Auth flows use `makeAuth()`, `signUp`, `enableTwoFactor`, `googleSession` and `totpNow` from `src/test/auth.ts`.
  - `vp check` and `vp test` pass at the end of every task (`vp run db:test:up` first).

## Review Focus

1. **A closure requested while the cron is mid-run for that user.** The customer presses "Keep my account" as the job closes it. Exactly one of the two wins, and neither returns a 500. Test in Task 5 (two concurrent transactions on the locked closure row).
2. **A user with 2FA on who signed in with Google and also has a password.** The confirm step asks for the password and the code, not a fresh Google sign-in (same rule as 4.6's Review Focus 1). Test in Task 3.
3. **The banner on a page loaded from a CDN-cached route.** `/privacy` and `/cookies` are cached publicly, so the banner must never be rendered into their HTML. It's loaded client-side from a `private, no-store` server function. Test in Task 7 (the `/privacy` response has no banner markup and keeps `publicCacheHeaders`).
4. **Signing in during the window on a second device.** It works, shows the banner, and the closure is unchanged. Request only ended sessions that existed at that moment. Test in Task 4.
5. **A user whose policies belong to a bundle, and one with only a refunded payment on an unbought quote.** Both go down the closure path, and the closure keeps the quote. The run doesn't hit `RESTRICT` every day. Test in Task 5.

---

### Task 1: Schema, constants, audit actions and error codes

**Files:**
- Create: `src/server/db/schema/account.ts`, `src/server/account/constants.ts`, the generated migration `drizzle/0012_*.sql`, and the hand-written `drizzle/0013_account_closures_triggers.sql` (`drizzle-kit generate --custom`)
- Modify:
  - `src/server/db/schema/index.ts`
  - `src/server/db/data-contract.ts`
  - `src/server/audit/actions.ts` and its snapshot
  - `src/server/auth/errors.ts`
- Test: `src/server/db/constraints.int.test.ts`, `src/server/audit/actions.test.ts`, `src/server/auth/errors.test.ts`

**Interfaces:**
- Produces:
  - **The table:** `accountClosures` with these columns:
    - `id`, `userId` (FK `users.id`, `restrict`)
    - `requestedAt`, `closesAt`
    - `cancelledAt`, `heldSince`, `holdReason`, `closedAt`, `retainUntil` (all nullable)
    - `createdAt`, `updatedAt`
  - **The constants:** `CLOSURE_WINDOW_DAYS`, `RETENTION`, `CLOSE_LIMIT`, `OPEN_CLAIM_STATUSES`
  - **The error codes:** `AuthzCode` gains `STAFF_ACCOUNT | ACCOUNT_CLOSED | CLOSURE_NOT_OPEN`, and `STATUS` allows 404 for the last

- [ ] **Step 1: Write the failing tests**
  - **`constraints.int.test.ts`:**
    - a second open closure for one user violates `account_closures_open_unique`
    - a row with both `cancelled_at` and `closed_at` violates `account_closures_one_ending_check`
    - `closes_at <> requested_at + interval '30 days'` violates `account_closures_window_check`
    - deleting a closure row writes a `deleted_rows` row
    - an update bumps `updated_at`
  - **`actions.test.ts`:** the snapshot includes the five `account.*` actions, each `entityType: "user"`.
  - **`errors.test.ts`:** each new code maps to its status and its fixed sentence.
- [ ] **Step 2: Run them**
  - Run: `vp test --project integration src/server/db/constraints.int.test.ts` and `vp test --project unit src/server/audit src/server/auth/errors.test.ts`
  - Expected: FAIL (no table, no actions).
- [ ] **Step 3: Implement**
  - **The schema:** a partial unique index on `user_id` where `cancelled_at is null and closed_at is null`, the two `CHECK`s above, and indexes on `(closes_at)` where open and on `(user_id)`.
  - **Migrations:** `vp run db:generate` for the table. `0013` attaches 0002's `record_delete('id')` and the existing `set_updated_at` trigger.
  - **The data contract entry:**
    - `kind: "mutable"`, `changeColumn: "updated_at"`, `copied: true`
    - columns: `hold_reason: "drop"` (it carries a claim reference), everything else `keep`
- [ ] **Step 4: Run them again.** Expected: PASS, and `data-contract.test.ts` passes.
- [ ] **Step 5: Commit** `feat(4.7): account_closures table, closure constants, audit actions and error codes`

### Task 2: Account state, records on file, and closed users out of `getActor`

**Files:**
- Create: `src/server/data/account.ts`, `src/server/data/account.int.test.ts`
- Modify: `src/server/auth/actor.ts` (`resolveActor`), `src/server/auth/actor.int.test.ts`

**Interfaces:**
- Consumes: Task 1's table and constants.
- Produces (all in `src/server/data/account.ts`):
  - `type AccountState = { kind: "active" } | { kind: "closure_requested"; closureId: string; closesAt: Date; heldSince: Date | null } | { kind: "closed"; closedAt: Date }`
  - `getAccountState(db: Db | Tx, userId: string): Promise<AccountState>`
  - `recordsOnFile(db: Db | Tx, userId: string): Promise<{ policies: { id: string; product: string; status: string }[]; claims: { reference: string; open: boolean }[]; hasPayments: boolean; hasBundles: boolean }>`
  - `hasRecordsOnFile(r): boolean` (any policy, payment or bundle)
  - `openClaimReference(db: Db | Tx, userId: string): Promise<string | null>` (the oldest open claim's reference)

- [ ] **Step 1: Write the failing tests** (`account.int.test.ts`)
  - **`getAccountState`:**
    - no rows → `active`
    - an open row → `closure_requested`
    - a cancelled row → `active`
    - a closed row → `closed`
  - **`recordsOnFile`:**
    - a fresh user (no customer row) → empty and false
    - a quote only → false
    - a policy in each of `active`, `cancelled`, `lapsed` → true
    - a refunded payment on an unbought quote → true
    - a bundle → true
    - claims list `open` from `OPEN_CLAIM_STATUSES`, and a `draft` claim isn't listed
  - **`actor.int.test.ts`:** `resolveActor` returns null for a user with a closed closure, and an Actor for one with an open closure.
- [ ] **Step 2: Run them.** Run `vp test --project integration src/server/data/account.int.test.ts src/server/auth/actor.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions. Then `resolveActor` checks `getAccountState` (one indexed lookup) after loading the user.
- [ ] **Step 4: Run them again.** Expected: PASS, and the 4.5 permission suite is still green (`vp test --project integration src/server/data`).
- [ ] **Step 5: Commit** `feat(4.7): account state and records on file`

### Task 3: Proving it's you

**Files:**
- Create: `src/server/account/confirm.ts`, `src/server/account/confirm.int.test.ts`

**Interfaces:**
- Consumes: `getAuth()`, `PASSWORDLESS_FRESH_MS`, `Actor`, `rejected`.
- Produces:
  - `const confirmInput = z.object({ password: z.string().optional(), code: z.string().optional() })`
  - `confirmIdentity(actor: Actor, input: z.infer<typeof confirmInput>, headers: Headers): Promise<Rejected | null>`
    - null means proven
    - **The password:** if the user has a credential account, it's required (`auth.api.verifyPassword`). Otherwise the session's `createdAt` must be within `PASSWORDLESS_FRESH_MS`.
    - **The code:** if 2FA is on, it's required. A code matching `/^\d{6}$/` (spaces stripped) goes to `auth.api.verifyTOTP`; anything else goes to `auth.api.verifyBackupCode`. Neither call is sent `trustDevice`.

- [ ] **Step 1: Write the failing tests**
  - **The password:** right → null; wrong → `rejected` with `fields.password`.
  - **Google-only:** a 9-minute-old session → null; an 11-minute-old one (backdate with `tamper`) → `rejected` with the Google message.
  - **Google and a password:** the password is required, and session age doesn't matter (Review Focus 2).
  - **The 2FA code:**
    - with 2FA on and no code → `rejected` with `fields.code`
    - a wrong code → `rejected`, and `two_factors.failed_verification_count` rises by 1
    - `totpNow` → null
    - a backup code → null, and the code is used up
    - the 10th wrong code → the account is locked, and an 11th call with the right code is still `rejected`
- [ ] **Step 2: Run them.** Run `vp test --project integration src/server/account/confirm.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `confirmIdentity`.
  - Map Better Auth's `APIError` codes to the rejections above. A lock (`TOO_MANY_REQUESTS`) maps to `fields.code`: "Too many wrong codes. Try again in 15 minutes."
  - **If the failure count does not rise:** that means Better Auth didn't run the plugin hooks for `auth.api` calls. In that case, move `assertNotLocked` / `countFailure` / `resetFailures` out of `kerbTwoFactor()` into `src/server/auth/two-factor-lockout.ts` as `(db, userId)` functions, call them here, and note the change in the spec's Results.
- [ ] **Step 4: Run them again.** Expected: PASS, and `two-factor.int.test.ts` is still green.
- [ ] **Step 5: Commit** `feat(4.7): confirmIdentity for irreversible account actions`

### Task 4: Immediate delete, request and cancel

**Files:**
- Create:
  - `src/server/account/files.ts`
  - `src/server/account/delete.ts`
  - `src/server/account/closure.ts`
  - `src/server/account/emails.ts`
  - `src/server/account/account.int.test.ts`
- Modify:
  - `src/server/email/templates.ts` (five templates)
  - `src/server/data/account.ts` (the write queries)
  - `src/server/data/index.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `audit`, `withTx`, `limit`, `rateLimitSubject`, `defineWrite`, `signOutEverywhere`'s pattern.
- Produces:
  - **The R2 hook:** `deleteUserFiles(tx: Tx, userId: string): Promise<void>`, a no-op that 4.10 fills in. It's exported as a mutable test seam: `filesHook = { deleteUserFiles }`.
  - **Delete:** `deleteAccount(db: Db, actor: Actor, input, headers: Headers, deps: AccountDeps): Promise<WriteResult<{ deleted: true }>>`. Not `defineWrite`; spec call 12.
  - **Request:** `requestClosure = defineWrite(confirmInput, { limit: { action: "account.close", rule: CLOSE_LIMIT }, idempotent: { action: "account.close" } }, run)`, returning `{ closesAt: string }`.
  - **Cancel:** `cancelClosure = defineWrite(z.object({}), { limit: …, idempotent: { action: "account.keep" } }, run)`, returning `{ kept: true }`.
  - **Email deps:** `AccountDeps = { sendEmail: SendEmail; defer: (p: Promise<unknown>) => void }`
  - **Templates:**
    - `accountDeletedEmail()`
    - `closureRequestedEmail({ closesOn })`
    - `closureCancelledEmail()`
    - `closureHeldEmail({ claimReference })`
    - `accountClosedEmail()`

- [ ] **Step 1: Write the failing tests** (`account.int.test.ts`)
  - **Delete:**
    - **A fresh sign-up:** `deleteAccount` removes the `users`, `sessions`, `accounts`, `security_events` and `idempotency_keys` rows, and a quote with no payment.
    - **The records:** `deleted_rows` has the user's copied rows. Exactly one `account.deleted` exists, with `actor_user_id` = the user. The user's earlier `two_factor.disabled` row still exists, and `verifyAuditChain()` is ok.
    - **The R2 hook:** `filesHook.deleteUserFiles` (spied) is called once with the tx. Making it throw rolls everything back.
    - **The email:** one email goes to the original address.
    - **A second call** after the first gets `UNAUTHENTICATED` from `requireUser`, not a database error.
    - **The two refusals:** a user with a policy gets `rejected` ("You have insurance records, so your account will be closed instead."). A staff user, active or deactivated, gets `AuthzError("STAFF_ACCOUNT")`.
  - **Request:**
    - **For a user with a policy:** one open closure, `closes_at = requested_at + 30 days`, and `account.closure_requested` with `{ closesAt }`.
    - **Sessions:** the other sessions are gone and the current one remains. A session created after the request survives (Review Focus 4).
    - **Repeats:** the same idempotency key → same result and one row. A new key → `rejected` ("Your account is already closing.").
    - **The refusals:** a user with nothing on file → `rejected` (use delete). A staff user → `STAFF_ACCOUNT`.
  - **Cancel:**
    - an open closure → `cancelled_at` is set, `account.closure_cancelled` is written, and an email goes out
    - no open closure → `CLOSURE_NOT_OPEN`
    - a closed one → `ACCOUNT_CLOSED`
    - a new request after a cancel creates a second row
- [ ] **Step 2: Run them.** Run `vp test --project integration src/server/account/account.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in the order of spec call 17 for delete:
  1. `confirmIdentity`
  2. `limit()`
  3. In one `withTx`:
     - lock the `users` row `FOR UPDATE`
     - re-check that there are no records on file and no staff row
     - write `audit`
     - call `filesHook.deleteUserFiles`
     - delete the user
  4. After the commit: `defer(sendEmail)`.

  For request and cancel, run `confirmIdentity` first (request only), then the `defineWrite` run. Inside it:
  - lock the user's open closure row
  - check `getAccountState`
  - write the row and `audit` in the same tx
  - delete the user's other sessions (request)

  The emails are deferred after the result.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(4.7): immediate delete, closure request and cancel`

### Task 5: The daily run, the script and the cron route

**Files:**
- Create:
  - `src/server/account/run-closures.ts` and `src/server/account/run-closures.int.test.ts`
  - `src/routes/api/cron/account-closures.ts` and `src/routes/api/cron/account-closures.int.test.ts`
  - `scripts/run-closures.ts`
  - `vercel.json`
- Modify:
  - `src/server/data/account.ts` (`closeAccountRows`)
  - `src/server/env.ts` (`getCronSecret()`)
  - `.env.example` (`CRON_SECRET=` name only)
  - `package.json` (`"account:run-closures": "node scripts/run-closures.ts"`)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `runClosures(db: Db, now: Date, deps: AccountDeps): Promise<{ closed: number; held: number; failed: number }>`
  - `closeAccountRows(tx: Tx, userId: string): Promise<void>`, which applies call 9's table exactly, including deleting `verifications` where `value = userId`
  - `getCronSecret(): string`, which throws if it's missing
  - `vercel.json`: `{ "crons": [{ "path": "/api/cron/account-closures", "schedule": "0 3 * * *" }] }`

- [ ] **Step 1: Write the failing tests**
  - **`run-closures.int.test.ts`:**
    - **Before day 30:** `runClosures(db, requestedAt + 29d)` → nothing changes.
    - **Day 30, settled claim only:**
      - **The closure row:** `closed_at` is set, and `retain_until = closed_at + 7 years`.
      - **Audit:** `account.closed` is written with `{ retainUntil }`.
      - **Kept:** the user row is scrubbed to the exact values in Global Constraints. The customer, policy, settled claim, payment and `security_events` rows still exist, and the claim still joins to the user id.
      - **Gone:** the `accounts`, `sessions`, `two_factors`, notifications and reviews rows; a draft claim; and an unbought quote with no payment. An unbought quote with a refunded payment stays (Review Focus 5).
      - **The email:** one email goes to the original address.
    - **An open claim:**
      - **First run:** `held_since` is set, `hold_reason = "claim_open:<ref>"`, there's one `account.closure_held`, and one email goes out.
      - **A second run:** nothing new, and still one held row.
      - **After the claim is set to `settled`:** the next run closes the account, and `account.closed` carries `{ heldSince, retainUntil }`.
    - **Running twice on one day** → the second returns `{ closed: 0, held: 0, failed: 0 }`.
    - **A failing closure:** the `filesHook` (or a broken row) for user A throws, and user B still closes, with `failed: 1`.
    - **After closure:**
      - A reset token created before closure no longer exists. Posting `/reset-password` with it fails, and the user has no `accounts` row.
      - `signUp(auth, originalEmail)` creates a new user id.
      - `getActor` for the old session cookie → null.
    - **The race (Review Focus 1):** `cancelClosure` and `runClosures` start together on the same due closure. Exactly one of `cancelled_at` / `closed_at` is set. The loser gets `ACCOUNT_CLOSED` or is skipped, and there's no unhandled error.
  - **`account-closures.int.test.ts`:**
    - no `Authorization` → 401
    - `Bearer wrong` → 401
    - `Bearer ${secret}` → 200 with the counts JSON
    - `GET` only
- [ ] **Step 2: Run them.** Run `vp test --project integration src/server/account/run-closures.int.test.ts src/routes/api/cron`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - **`runClosures`:** select due open closures (`closes_at <= now`, `cancelled_at` and `closed_at` null). Each gets its own `withTx` that:
    - re-reads the row `FOR UPDATE SKIP LOCKED`
    - skips it if it's no longer open
    - otherwise holds or closes it

    Errors are caught per closure through `logSafeError` and counted.
  - **The route:** compares the secret with `timingSafeEqual`.
  - **The script:** follows `scripts/reset-two-factor.ts` (loads `.env.local`, prints the database host, never emails) and reads `NOW=` as an ISO date. It's plain node, so it imports `runClosures` through a `-core.ts` with raw SQL, as `reset-two-factor-core.ts` does. Or, if the runner already loads TS aliases, it imports it directly; check `make-admin.ts` first.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(4.7): daily account-closure run, cron route and script`

### Task 6: Server functions and the closure screens

**Files:**
- Create:
  - `src/features/account/closure.ts` (server functions)
  - `src/features/account/ClosePage.tsx`, `src/features/account/ClosureBanner.tsx`, `src/features/account/account.browser.test.tsx`
  - `src/routes/account_.close.tsx`, `src/routes/_auth/account-deleted.tsx`
- Modify:
  - `src/features/auth/AccountPage.tsx` (a "Close your account" section linking to `/account/close`)
  - `src/components/site/SiteLayout.tsx` (mounts `ClosureBanner` for signed-in users)

**Interfaces:**
- Consumes: Task 4's writes and Task 2's `getAccountState` and `recordsOnFile`; `actorMiddleware`, `useIdempotencyKey`, `writeOutcome`, `ConfirmDialog` parts and `AuthShell`.
- Produces:
  - **`getClosePage`** (GET, `private, no-store`): `{ kind: "staff" } | { kind: "delete"; providers: string[]; twoFactor: boolean } | { kind: "close"; records; providers; twoFactor; openClaim: string | null } | { kind: "closing"; closesAt: string; held: boolean }`
  - **`getClosureBanner`** (GET, `private, no-store`): `{ closesAt: string; held: boolean } | null`
  - **The writes:** `deleteMyAccount`, `requestMyClosure`, `keepMyAccount` (POST)

- [ ] **Step 1: Write the failing component tests**
  - **The delete version:** the spec's copy, the password field, and the code field only when `twoFactor`. "Delete my account" calls `deleteMyAccount`, and success navigates to `/account-deleted`. An `UNAUTHENTICATED` result also navigates there.
  - **The close version:**
    - lists each policy (product, status) and claim (reference, open or closed)
    - "Closing your account doesn't cancel your cover." is present
    - the open-claim line shows when `openClaim` is set
    - "Request account closure" calls `requestMyClosure`
  - **Google-only:** "Continue with Google" replaces the password field.
  - **Staff:** the `STAFF_ACCOUNT` sentence, and no form.
  - **The banner:**
    - open → "Your account closes on 7 December." (`en-GB`, `Europe/London`)
    - held → "Your account will close once your claim is settled."
    - "Keep my account" calls `keepMyAccount` and then shows a confirmation
    - nothing renders when `getClosureBanner` returns null
- [ ] **Step 2: Run them.** Run `vp test --project component src/features/account`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - **The routes:**
    - **`/account/close`:** uses `requireSignedIn` in `beforeLoad` and `Cache-Control: private, no-store`. Its `head` title is "Close your account · Kerb".
    - **`/account-deleted`:** a static page linking home.
  - **The banner** fetches `getClosureBanner` on the client after mount, so cached HTML never contains it.
- [ ] **Step 4: Run them again.** Expected: PASS, and `vp run generate-routes` is clean.
- [ ] **Step 5: Commit** `feat(4.7): close-account screens, banner and account-deleted page`

### Task 7: `/privacy` and `/cookies`

**Files:**
- Create:
  - `src/routes/_site/privacy.tsx`, `src/routes/_site/cookies.tsx`
  - `src/features/legal/PrivacyNotice.tsx`, `src/features/legal/CookiesPage.tsx`, `src/features/legal/legal.browser.test.tsx`
  - `src/features/legal/cookies.ts` (the cookie list as data)
- Modify: `src/components/site/SiteFooter.tsx`, to export the `CookieSettings` opener for reuse

**Interfaces:**
- Consumes: `RETENTION`, `publicCacheHeaders`, `CookieSettings`, `consent.ts`.
- Produces: `COOKIES: { name: string; purpose: string; duration: string; when: "always" | "after consent" }[]`, with entries for:
  - Better Auth's session token and session-data cache (the names from `auth.ts` config)
  - the two-factor trust cookie (30 days)
  - PostHog's `ph_<key>_posthog` (after consent)

- [ ] **Step 1: Write the failing tests**
  - **`legal.browser.test.tsx`:**
    - **`/privacy` names:** "OpsEd Solutions", `privacy@kerb.opsedsolutions.com` as a `mailto:` link, PostHog, and every processor from the spec.
    - **`/privacy` content:** the retention table built from `RETENTION` (7 years, 12 months) and labelled illustrative, a link to `/account/close`, a link to `/cookies`, the ICO, and "Last updated".
    - **`/cookies`:** one row per `COOKIES` entry, and a "Cookie settings" button that reopens the consent bar. Without PostHog, a line replaces the button.
  - **An integration test on the route responses:** `/privacy` and `/cookies` carry `publicCacheHeaders()`, and their HTML has no `ClosureBanner` markup (Review Focus 3).
- [ ] **Step 2: Run them.** Run `vp test --project component src/features/legal`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - **The copy:** plain English, in the spec's section order. It's written to be read by Damion in the PR (spec, "What you set up").
  - **`COOKIES`:** check it against the cookies a real sign-in sets in `auth.int.test.ts`. Add one assertion there that every `Set-Cookie` name the auth flow issues has a `COOKIES` entry.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(4.7): privacy notice and cookies page`

### Task 8: E2E, docs and the final checks

**Files:**
- Create: `e2e/account-close.spec.ts`
- Modify:
  - `plan/engineering.md` (§7 "Account closure", §6's "Delete account" line)
  - `plan/phases/04-data-auth/02-schema.md` (decision 11: superseded by 4.7)
  - `plan/phases/04-data-auth/phase.md` (the 4.7 row and its testing row)
  - `plan/build-plan.md`
  - the spec (steps ticked, a Results section)

- [ ] **Step 1: Write the E2E test.**
  - **The flow:** sign up (Turnstile test keys) → confirm → `/account/close` → password → "Delete my account" → `/account-deleted`.
  - **Then:** logging in with the same email and password fails.
  - **Accessibility:** axe has no violations on `/privacy`, `/cookies`, `/account/close` and `/account-deleted`.
- [ ] **Step 2: Run it.** Run `vp exec playwright test e2e/account-close.spec.ts`. Expected: PASS.
- [ ] **Step 3: Update the docs** listed above. They should say what 4.7 does, the two paths, and that 9.7's erasure test uses the immediate path.
- [ ] **Step 4: Run the full checks.** Run `vp check`, `vp test` and `vp build`. Expected: all pass. Paste the counts into the spec's Results.
- [ ] **Step 5: Commit** `docs(4.7): engineering notes, phase row and results`
- [ ] **Step 6: Hand over to Damion.** That covers the "What you set up" items (`privacy@`, `CRON_SECRET`, reading the notice), then the walkthrough on `dev`:
  - delete a fresh sign-up
  - close a fixture account
  - `NOW=<+31d> vp run account:run-closures`
  - check Neon and the five emails
