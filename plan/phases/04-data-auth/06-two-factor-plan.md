# 4.6 Two-factor and sessions: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can't reach any staff page without TOTP, and a session that owes a code can do nothing else. Customers can turn TOTP on. Sessions can be ended everywhere and are revoked on a password change. Every step is recorded, and the audit log gets one typed list of actions.

**Architecture:**
- **Our 2FA hooks live in a small Better Auth plugin.** `kerbTwoFactor()`, in `src/server/auth/two-factor.ts`, is registered straight after `twoFactor()`.
  - Better Auth runs `hooks.before`/`hooks.after` first, then plugin hooks in plugin order (`api/dispatch.mjs` 141–171). So only a plugin placed after `twoFactor()` sees its outcome. The clearest case: `twoFactor()`'s after hook on `/sign-in/email` is what deletes the half-made session.
  - Before hooks pass what they found to the after hooks by returning `{ context: { kerb2fa } }`, which dispatch merges onto the endpoint context (`dispatch.mjs` 213–222).
- **The `Actor`** carries `twoFactor`, so `requireUser`, `requirePermission` and `requireFresh` decide without another query.
- **The guards are UX only.** They read the same `Actor`.
- **The screens** are auth-layout pages using Better Auth's `twoFactorClient`.

**Tech Stack:** Better Auth 1.7.15 (`twoFactor` plugin), TanStack Start 1.169, Drizzle 0.45 + node-postgres, zod 4.6, Postgres 18 (Docker on `localhost:5433`), Vitest via `vite-plus/test` (projects `unit`, `integration`, `component`), `vitest-browser-react`, Playwright for E2E, `uqr` for the QR code (new dependency, pure JS, SVG out).

**Spec:** [06-two-factor.md](06-two-factor.md) (approved 6 Nov 2026). It builds on [05-authorization.md](05-authorization.md), [05b-audit-integrity.md](05b-audit-integrity.md), [05c-safe-write-tools.md](05c-safe-write-tools.md) and their Results, and on [03-auth-screens.md](03-auth-screens.md). Read the spec first. Call numbers below are the spec's.

## Global Constraints

- **Branch and PR:**
  - Work in the worktree `../kerb-4.6`, branch `slice/4.6-two-factor` (from `staging`).
  - One commit per task (Conventional Commits), ending with the `Co-Authored-By` trailer.
  - Nothing is pushed and no PR is opened until Damion says so. The PR goes into `staging` and is squash-merged with the spec's commit message.
- **Fixed sentences (verbatim):**
  - `TWO_FACTOR_CHALLENGE` (401): "Enter your two-factor code to continue."
  - `TWO_FACTOR_REQUIRED` (403): "Staff accounts need two-factor. Set it up to continue."
  - `SESSION_NOT_FRESH` (403): "Confirm it's you to continue."
  - 09b after the challenge is used up, or after it expires: "Too many tries. Sign in again."
  - 10: "Each backup code works once."
  - Any other copy comes from the approved Figma frames.
- **Numbers (each one constant, in `src/server/auth/two-factor-constants.ts`, which imports nothing):**
  - staff freshness: `STAFF_FRESH_MS = 2 * 60 * 60 * 1000`
  - changing 2FA without a password: `PASSWORDLESS_FRESH_MS = 10 * 60 * 1000`
  - signed-in lockout: `LOCKOUT_AFTER = 10` and `LOCKOUT_MS = 15 * 60 * 1000`, matching the plugin's defaults
  - trusted device: 30 days (`trustDeviceMaxAge: 30 * 24 * 60 * 60`)
  - verify rate limits: `{ window: 15 * 60, max: 10 }` on each verify path
- **The challenge allowlist (call 5), exact:**
  - `/two-factor/verify-totp`
  - `/two-factor/verify-backup-code`
  - `/sign-out`
  - `/get-session`
  - `/sign-in/social`
  - any path starting `/callback/`

  Everything else is refused with `TWO_FACTOR_CHALLENGE`.
- **`two_factor_verified_at` is written only by `kerbTwoFactor()`'s after hooks.** The exception is the password-change copy, and the reset script, which deletes sessions instead. It's declared `input: false`.
- **Audit:** every `audit()` call names an `AuditAction`. `audit()` derives `entityType` from `AUDIT_ACTIONS`, and the callers no longer pass it.
- **Logs:** ids and codes only, never emails, codes, secrets or IPs. Unexpected errors go through `logSafeError`.
- **Tests:**
  - Imports come from `vite-plus/test`.
  - Integration tests call `truncateAll()` in `beforeEach`, and backdate rows with `tamper()`.
  - Auth tests build their instance with `makeAuth()` from `auth.int.test.ts` (moved to `src/test/auth.ts` in Task 3) and generate codes with `totpNow(secret)`.
  - `vp check` and `vp test` pass at the end of every task (`vp run db:test:up` first).

## Review Focus

1. **A Google user who also has a password** sees the password version of 11a, not the Google one. The plugin requires the password whenever a credential account exists (`shouldRequirePassword`), so the page asks for it. Test in Task 9 (11a picks its version from `providers`).
2. **The challenge page opened with no pending challenge** (a bookmark, a second tab after success, or a guest): a signed-in, stamped session is sent on to `redirect`, and a guest to `/login`. Neither gets a dead form. Test in Task 8 (guard).
3. **A code typed with spaces or a dash** (`123 456`, `12345-67890` in either case) is normalised before sending: spaces are stripped, and backup codes are upper-cased with the dash kept. So a correct code pasted from an authenticator or a password manager works. Test in Task 9.
4. **`?redirect=` on the challenge and setup pages** goes through `safeRedirect`, so `//evil.example` falls back to `/account`, or to `/staff` for staff. Test in Task 9.
5. **A staff member whose roles are all removed while their session owes a code** is treated as a customer by `getStaffAccess()` (4.5's rule). Their customer pages still challenge them. Test in Task 8.

---

### Task 1: The three missing Figma states (Damion approves before Task 9)

**Files:**
- Figma `ajpEaPwbWtwbsSmRheyDAU`, page `Account · Web (two-factor)` `205:4701`
- Modify: `plan/figma.md` (the two-factor row)

- [ ] **Step 1:** Load `/figma-use`, then `create_session` on the file. Read frames 09, 09b, 11a and 11b (`get_design_context`, `get_screenshot`) so the new states reuse their components and tokens.
- [ ] **Step 2:** Add **11a (Google)**:
  - the same shell as 11a, with "Confirm it's you" and a line saying Kerb will ask Google to confirm
  - one "Continue with Google" button (the existing Google button component) instead of the password field
  - "Cancel" as on 11a
- [ ] **Step 3:** Add **11b (mobile)**, 390 wide:
  - "Open in authenticator app" as the primary button, first
  - then "Or scan this code" with the QR, the setup key and its copy button, the code input and "Turn on two-factor"
- [ ] **Step 4:** Add **09b (too many tries)**: the 09 shell with an error `Alert` reading "Too many tries. Sign in again." and a primary "Back to log in" button. The code input is gone.
- [ ] **Step 5:** Record the three node ids in `plan/figma.md`'s two-factor row (mark it 4.6), and show Damion screenshots of the three.
- [ ] **Step 6:** **Stop for Damion's approval.** Make his changes, then commit `docs: 4.6 Figma states (Google 11a, mobile 11b, 09b too many tries)`.

---

### Task 2: The audit action list

**Files:**
- Create: `src/server/audit/actions.ts`, `src/server/audit/actions.test.ts`
- Modify: `src/server/audit/audit.ts` (`AuditEntry`), `src/server/data/claims.ts:155`, `src/server/data/referrals.ts:131-134`, `scripts/make-admin-core.ts` (the `staff.added` row), `src/server/audit/audit.int.test.ts` (callers)

**Interfaces:**
- Produces:
  ```ts
  export const AUDIT_ACTIONS = {
    "claim.viewed":         { entityType: "claim",      description: "A staff member opened a claim" },
    "referral.viewed":      { entityType: "quote_item", description: "A staff member opened a referral" },
    "staff.added":          { entityType: "user",       description: "Someone was made staff" },
    "two_factor.disabled":  { entityType: "user",       description: "Two-factor was turned off" },
    "sessions.revoked_all": { entityType: "user",       description: "Signed out everywhere" },
    "two_factor.reset":     { entityType: "user",       description: "Two-factor was reset by an admin script" },
  } as const;
  export type AuditAction = keyof typeof AUDIT_ACTIONS;
  ```
- `AuditEntry` becomes `{ actor; action: AuditAction; entityId; changes?; reason?; requestId?; ipHash? }`, with no `entityType`.
- `actions.ts` imports nothing. The scripts import it as `../src/server/audit/actions.ts`.

- [ ] **Step 1: Write the failing tests** in `actions.test.ts`:
  - `pins the list`: `expect(AUDIT_ACTIONS).toMatchSnapshot()`
  - `every name is area.verb`: each key matches `/^[a-z][a-z_]*\.[a-z][a-z_]*$/`, the same pattern as `audit_log_action_check` in `0001`
  - `an unknown name is a type error`: `// @ts-expect-error` above `const _x: AuditAction = "claim.deleted";`
- [ ] **Step 2: Run** `vp test --project unit src/server/audit/actions.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `actions.ts`.
  - In `audit.ts`, take `action: AuditAction` and set `entityType: AUDIT_ACTIONS[entry.action].entityType`.
  - Remove `entityType` from the three callers.
  - `make-admin-core.ts` reads `AUDIT_ACTIONS["staff.added"].entityType`.
- [ ] **Step 4: Run** `vp check` and `vp test --project unit --project integration src/server/audit src/server/data scripts`. Expected: PASS, and the chain tests are unchanged.
- [ ] **Step 5: Commit** — `feat: a typed list of audit actions; audit() takes its entity type from it`

---

### Task 3: Schema, plugin options, rate limits and the test helpers

**Files:**
- Create: `drizzle/0011_<generated>.sql` (via `vp run db:generate`), `src/test/auth.ts`, `src/test/totp.ts`
- Modify: `src/server/db/schema/auth.ts` (`sessions.twoFactorVerifiedAt`), `src/server/db/schema/security.ts`, `src/server/db/data-contract.ts` (`sessions.columns.two_factor_verified_at: "drop"`), `src/server/auth/auth.ts`, `src/server/auth/security-events.ts` (`method` type), `src/server/auth/auth.int.test.ts` (import the moved helpers), `package.json` (`uqr`), `src/features/auth/auth-client.ts` (`twoFactorClient()`)

**Interfaces:**
- Produces:
  - `sessions.twoFactorVerifiedAt: timestamp("two_factor_verified_at", { withTimezone: true })`, nullable
  - `SECURITY_EVENT_TYPES` gains, in this order: `two_factor_enabled`, `two_factor_disabled`, `backup_codes_regenerated`, `two_factor_passed`, `two_factor_failed`, `signed_out_everywhere`, `sessions_revoked_on_password_change`
  - `SECURITY_EVENT_METHODS = ["password", "google", "totp", "backup_code"]`
  - `SecurityEventInput.method` widens to that union
- `src/test/auth.ts`:
  - `makeAuth(overrides?)`, `post(auth, path, body, extraHeaders?)`, `sessionCookie(res)` and `signUp`, moved from `auth.int.test.ts` unchanged
  - new: `signInWithPassword(auth, email) → Response`
  - new: `enableTwoFactor(auth, cookie) → { cookie: string; secret: string; backupCodes: string[] }`, which runs `/two-factor/enable` then `/two-factor/verify-totp` and returns the new session's cookie
  - new: `googleSession(userId) → cookie`, which inserts a `sessions` row through Better Auth's `internalAdapter.createSession` and signs the cookie, standing in for a Google callback
- `src/test/totp.ts`: `totpNow(secretBase32: string, at?: Date): Promise<string>`, using `createOTP` from `@better-auth/utils/otp`. The secret comes from the `otpauth://` URI's `secret` parameter.

- [ ] **Step 1: Write the failing tests:**
  - In `src/server/db/constraints.int.test.ts`: `security_events accepts the 4.6 types and methods`. Insert one row per new type with `method: "totp"`, then one with `"backup_code"`. Expect no error. An unknown type such as `"two_factor_maybe"` is still refused with SQLSTATE `23514`.
  - In `auth.int.test.ts`: `the browser can't set two_factor_verified_at`. Sign in, POST `/update-session` with `{ twoFactorVerifiedAt: new Date().toISOString() }`, then read the row with the owner db. Expect the column to be `null`, whatever the status.
  - In `data-contract.test.ts`: the existing every-column-classified check fails until the column is listed.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - the schema changes, then `vp run db:generate` and review the SQL (it should drop and re-add the two checks and add the column only)
  - in `auth.ts`, `session.additionalFields.twoFactorVerifiedAt: { type: "date", required: false, input: false }`
  - `twoFactor({ issuer: "Kerb", allowPasswordless: true, trustDeviceMaxAge: 30 * 24 * 60 * 60 })`, with the lockout left at its defaults
  - the two `customRules`
  - `pnpm add uqr`
  - `twoFactorClient()` in `auth-client.ts`, with no `onTwoFactorRedirect`, because the form handles it
  - the moved helpers
- [ ] **Step 4: Run** `vp run db:migrate` against the test db (`vp run db:test:up` applies it), then `vp test --project unit --project integration`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: sessions.two_factor_verified_at, the 2FA security event types, plugin options and verify rate limits`

---

### Task 4: `Actor`, the error codes and `requireFresh`

**Files:**
- Modify: `src/server/auth/actor.ts`, `src/server/auth/errors.ts`, `src/test/world.ts`, `src/test/factories.ts`, `src/server/auth/actor.test.ts`, `actor.int.test.ts`, `errors.test.ts`, `src/features/staff/access.int.test.ts`

**Interfaces:**
- Produces:
  - `Actor.twoFactor: { enabled: boolean; verifiedAt: Date | null }`
  - `resolveActor(db, userId, session?: { twoFactorVerifiedAt: Date | null })`. `enabled` comes from `users.two_factor_enabled`. `verifiedAt` comes from `session?.twoFactorVerifiedAt ?? null`.
  - `getActor` passes `session.session`
  - `AuthzCode` gains `"TWO_FACTOR_CHALLENGE" | "TWO_FACTOR_REQUIRED" | "SESSION_NOT_FRESH"` (401, 403, 403, with the sentences above). `STATUS`'s type widens to match.
  - `requireUser(actor)` throws `TWO_FACTOR_CHALLENGE` when `enabled && verifiedAt === null`
  - `requirePermission(actor, p)`, in this order: `requireUser`, then staff with `!enabled` gives `TWO_FACTOR_REQUIRED`, then the permission check
  - `requireFresh(actor: Actor, now = new Date()): Actor` throws `SESSION_NOT_FRESH` unless `verifiedAt` is within `STAFF_FRESH_MS` of `now`. It's exported from `actor.ts`. Create `two-factor-constants.ts` in this task, with all five constants, so `actor.ts` doesn't load the plugin.
- Test support:
  - `makeStaff` sets the user's `two_factor_enabled = true` unless given `twoFactor: false`
  - `world.ts`'s `actorFor` passes `{ twoFactorVerifiedAt: new Date() }`

  So the 4.5 permission suite keeps meaning what it meant.

- [ ] **Step 1: Write the failing unit tests** in `actor.test.ts`, using a pure `actor()` builder:
  - `requireUser refuses a session owing a code`: `enabled: true, verifiedAt: null` gives `TWO_FACTOR_CHALLENGE`, status 401
  - `requirePermission refuses staff without 2FA`: gives `TWO_FACTOR_REQUIRED`, 403, even when the permission is held
  - `requirePermission challenges staff owing a code`: gives `TWO_FACTOR_CHALLENGE`
  - `a customer without 2FA passes requireUser`
  - `requireFresh`: `verifiedAt = now − 2h − 1ms` gives `SESSION_NOT_FRESH`, `now − 2h + 1s` passes, and `null` gives `SESSION_NOT_FRESH`
  - In `errors.test.ts`, `toPublicError` returns the three exact sentences and statuses. The `PublicError` round trip keeps `TWO_FACTOR_CHALLENGE`.
- [ ] **Step 2: Write the failing integration tests** in `actor.int.test.ts`:
  - `resolveActor reads two_factor_enabled`
  - `verifiedAt comes from the session passed in`
  - `getActor carries the session's stamp`: create a session row with a stamp, call `getActor` with its cookie, and expect `verifiedAt` to equal it
- [ ] **Step 3: Run** both. Expected: FAIL.
- [ ] **Step 4: Implement** the changes and update the factories and world.
- [ ] **Step 5: Run** `vp test` (all projects). Expected: PASS, including the unchanged 4.5 permission suite and `access.int.test.ts`.
- [ ] **Step 6: Commit** — `feat: the Actor knows about two-factor; TWO_FACTOR_CHALLENGE, TWO_FACTOR_REQUIRED, SESSION_NOT_FRESH and requireFresh`

---

### Task 5: `kerbTwoFactor()` part 1: the allowlist, stamping and sign-in recording

**Files:**
- Create: `src/server/auth/two-factor.ts`, `src/server/auth/two-factor.int.test.ts`
- Modify: `src/server/auth/auth.ts` (register `kerbTwoFactor({ db, record })` straight after `twoFactor(...)`; remove the `/sign-in/email` `sign_in` branch from `hooks.after` and keep its `sign_in_unverified` and `sign_in_failed` branches)

**Interfaces:**
- Consumes: Task 3's helpers and column; `resolveActor`; `recordSecurityEvent`.
- Produces: `kerbTwoFactor(deps: { db: Db; record: (e: SecurityEventInput) => Promise<void> }): BetterAuthPlugin` with `id: "kerb-two-factor"`. Its before hooks return `{ context: { kerb2fa: { mode: "sign-in" | "signed-in" | "setup"; userId: string; sessionId?: string; staff: boolean } } }` for the two verify paths:
  - **sign-in:** no session cookie, so the plugin uses the `two_factor` cookie
  - **setup:** a session whose user has `two_factor_enabled = false`
  - **signed-in:** everything else

**Behaviour (the after hooks run after `twoFactor()`'s):**
- **Stamp (call 4).** After a 200 from a verify path, stamp the session that survives:
  - in sign-in and setup modes, `ctx.context.newSession.session.id`
  - in signed-in mode, `kerb2fa.sessionId`

  Never the returned token. Record `two_factor_passed` with `method: "totp" | "backup_code"`. In sign-in mode also record `sign_in` with `method: "password"`.
- **Sign-in (`/sign-in/email`).** If `ctx.context.newSession` is still set, record `sign_in` (`password`). If its user has 2FA on, it came through a trusted device: stamp it, unless the user is staff (call 8). If `newSession` is null and the response is `{ twoFactorRedirect: true }`, return `ctx.json({ ...returned, kerbTrustDevice: !staff })`, so the form knows whether to show the tick box. Find staff from the email in the body.
- **The challenge allowlist (call 5),** in a before hook on every path:
  - if the path is on the allowlist, carry on
  - otherwise look up the session (`getSessionFromCtx`, `disableCookieCache`); if its user has 2FA on and its `twoFactorVerifiedAt` is null, throw `APIError("UNAUTHORIZED", { code: "TWO_FACTOR_CHALLENGE", message })`
- **Google sign-ins (`/callback/*`)** keep recording `sign_in` (`google`) in `hooks.after`, unchanged.

- [ ] **Step 1: Write the failing integration tests** in `two-factor.int.test.ts`:
  - `a sign-in code stamps the new session`: sign in with a password for a 2FA user (`twoFactorRedirect: true`), verify with `totpNow`, and expect the new session row's `two_factor_verified_at` to be within 5s of now
  - `the setup code stamps the session that survives`: run `enableTwoFactor`, then expect exactly one session row for the user, stamped, and the old token gone
  - `a signed-in code stamps the same session`: in a `googleSession` for a 2FA user, verify, and expect the same session id, now stamped
  - `a backup code stamps too, with method backup_code`
  - `sign_in is recorded once, after the code`: the `sign_in` count for the user is 0 after the password and 1 after the code, and `two_factor_passed` is 1
  - `a session owing a code is refused everywhere else`: with a `googleSession` for a 2FA user, each of `/two-factor/get-totp-uri`, `/two-factor/generate-backup-codes`, `/two-factor/disable`, `/change-password`, `/revoke-sessions`, `/update-user` and `/list-sessions` gives 401 with code `TWO_FACTOR_CHALLENGE`. `/get-session` and `/sign-out` give 200. After a code, `/list-sessions` gives 200.
  - `a customer's trusted device is stamped at sign-in`: verify with `trustDevice: true`, sign out, sign in again with the trust cookie, and expect the session to be created and stamped
  - `kerbTrustDevice is false for staff and true for customers`, on the `twoFactorRedirect` response
- [ ] **Step 2: Run** `vp test --project integration src/server/auth/two-factor.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `two-factor.ts` part 1 and the `auth.ts` changes.
  - The header comment explains the plugin-order reason and the `kerb2fa` hand-off.
  - Watch for this: `internalAdapter.createSession(userId, false, oldSession)` copies the old row's columns, ours included. So setup's new session inherits the old one's `null`, and disable's inherits its stamp.
- [ ] **Step 4: Run** the new file and `src/server/auth/auth.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: kerbTwoFactor stamps verified sessions, records sign-in after the code, and refuses everything else while a code is owed`

---

### Task 6: `kerbTwoFactor()` part 2: staff rules, freshness and lockout

**Files:**
- Modify: `src/server/auth/two-factor.ts`, `src/server/auth/two-factor.int.test.ts`, `src/server/auth/auth.int.test.ts` (rate limits)

**Behaviour:**
- **Staff (call 8).** Before a verify path, a staff user's body loses `trustDevice` (return a modified body through the merged context). `/two-factor/disable` for staff throws `APIError("FORBIDDEN", { code: "TWO_FACTOR_REQUIRED", message })`.
- **Changing 2FA without a password (call 7).** On `/two-factor/enable`, `/two-factor/disable`, `/two-factor/generate-backup-codes` and `/two-factor/get-totp-uri`: when the user has no `credential` account, the session's `createdAt` must be within `PASSWORDLESS_FRESH_MS`. Otherwise throw `APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message })`. Users with a password are left to the plugin's password check.
- **The signed-in lockout (call 9).** In `signed-in` and `setup` modes:
  - before: refuse with the plugin's `ACCOUNT_TEMPORARILY_LOCKED` (429) while `two_factors.locked_until > now()`
  - after a 401 `INVALID_CODE` or `INVALID_BACKUP_CODE`: run `update two_factors set failed_verification_count = failed_verification_count + 1, locked_until = case when failed_verification_count + 1 >= 10 then now() + interval '15 minutes' end where user_id = $1`
  - after a 200: reset both
  - record `two_factor_failed` (method by path) on every wrong code, in every mode

- [ ] **Step 1: Write the failing tests:**
  - `staff: trustDevice is stripped`: a staff sign-in verifies with `trustDevice: true`, and no `trust_device` cookie is set and no `trust-device-*` verification row exists
  - `staff: disable is refused`: 403, `TWO_FACTOR_REQUIRED`, and `users.two_factor_enabled` stays `true`
  - `an old trust cookie still leads to a challenge for staff`: a customer trusts a device, is made staff (`makeStaff({ userId })`), then signs in with the cookie. The session exists but has no stamp, and `getActor` plus `requirePermission` throws `TWO_FACTOR_CHALLENGE`.
  - `a Google-only user needs a session under 10 minutes old`: `/two-factor/enable` on a `googleSession` backdated 11 minutes with `tamper()` gives 403 `SESSION_NOT_FRESH`; at 9 minutes it gives 200
  - `a password user needs the password`: `/two-factor/enable` without a password gives 400 or 401 from the plugin, and with it gives 200
  - `the sign-in challenge is used up after 5 wrong codes`: the 6th answer is 400 `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`
  - `10 wrong codes in a row lock both modes for 15 minutes`: 10 wrong signed-in codes, then a right one, gives 429. A fresh sign-in challenge for the same user also gives 429. Backdate `locked_until` by 16 minutes, and the right code gives 200 with the count back to 0.
  - `a good signed-in code resets the count`: 3 wrong, 1 right, and the count is 0
  - In `auth.int.test.ts` with `rateLimit: true`: `the verify rate limit refuses the 11th try` (429 on the 11th POST to `/two-factor/verify-totp` from one IP, while `/two-factor/verify-backup-code` from the same IP still answers)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `vp test --project integration src/server/auth`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: staff can't trust a device or turn 2FA off; passwordless changes need a fresh sign-in; signed-in code checks share the lockout`

---

### Task 7: Recording, the audit row on disable, and the password change

**Files:**
- Modify: `src/server/auth/two-factor.ts`, `src/server/auth/auth.ts` (`hooks.before` on `/change-password` and `onPasswordReset`), `two-factor.int.test.ts`

**Behaviour:**
- **After a 200:**
  - `/two-factor/verify-totp` in setup mode records `two_factor_enabled`
  - `/two-factor/generate-backup-codes` records `backup_codes_regenerated`
  - `/two-factor/disable` records `two_factor_disabled`, then writes `audit(tx, { actor, action: "two_factor.disabled", entityId: userId })` inside `withTx(db, …)`. Here `actor` is `resolveActor(db, userId)`. On failure, `console.error("[audit] two_factor.disabled not written:", logSafeError(e))`, and the response stands.
- **Before `/two-factor/disable` (call 10):** `getAuditEnv()` inside `try`. On an `AuditConfigError`, throw `APIError("INTERNAL_SERVER_ERROR", { code: "INTERNAL", message: "Something went wrong. Please try again." })` before anything changes.
- **Password change (call 11):**
  - `hooks.before` on `/change-password` returns `{ context: { body: { ...ctx.body, revokeOtherSessions: true } } }` and stashes the current session's `twoFactorVerifiedAt` as `kerb2fa.carryStamp`
  - after a 200, `kerbTwoFactor()` writes `carryStamp` onto `ctx.context.newSession.session.id` and records `sessions_revoked_on_password_change`
  - `onPasswordReset` also records `sessions_revoked_on_password_change`, next to `password_reset`

- [ ] **Step 1: Write the failing tests:**
  - `each 2FA event writes its security_events row`: enable, regenerate, pass, fail and disable for a customer give one row each with the right type and method. `ip_hash` is 64 hex or null. No column contains the user's email.
  - `turning 2FA off writes two_factor.disabled and the chain verifies`: one `audit_log` row with that action, entity `user`, the user's id, and `actor_role = "customer"`. `verifyAuditChain(getDb().$client, keys).ok` is `true`.
  - `with bad audit keys, disable is refused and 2FA stays on`: build the auth with `AUDIT_KEYS` set to `"garbage"` (`vi.stubEnv`). Expect 500 `INTERNAL`, `two_factor_enabled` still `true`, and no `two_factor_disabled` event.
  - `a password change ends other sessions and keeps the user signed in and verified`: a staff user with two stamped sessions changes password with `revokeOtherSessions: false`. The old two are gone, one new session exists, its stamp equals the old one's, `requirePermission` passes through `getActor` with the new cookie, and the event is recorded.
  - `a reset ends all sessions and records it`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `vp test --project integration src/server/auth src/server/audit`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: 2FA events recorded; two_factor.disabled audited behind an audit-key check; password changes revoke other sessions and keep the stamp`

---

### Task 8: "Sign out everywhere", `auth:reset-two-factor` and the guards

**Files:**
- Create: `src/server/auth/sessions.ts`, `src/server/auth/sessions.int.test.ts`, `src/server/auth/auth-config.test.ts`, `scripts/reset-two-factor.ts`, `scripts/reset-two-factor-core.ts`, `scripts/reset-two-factor.int.test.ts`, `src/features/auth/guard.ts`, `src/features/auth/guard.int.test.ts`
- Modify: `package.json` (`"auth:reset-two-factor": "node scripts/reset-two-factor.ts"`), `src/features/staff/access.ts` (+ test), `src/routes/_staff.tsx`, `src/routes/account.tsx`, `src/features/auth/session.ts` (export the server fns the guards use)

**Interfaces:**
- **`signOutEverywhere(db: Db, actor: Actor, headers?: Headers): Promise<{ revoked: number }>`**
  - In `withTx`: `delete from sessions where user_id = $1 returning id`, then `audit(tx, { actor, action: "sessions.revoked_all", entityId: actor.userId, changes: { revoked } })`.
  - After the commit: record `signed_out_everywhere`.
  - `signOutEverywhereFn` is a POST server fn with `userMiddleware` that calls it. It's not linked from any page until 6.3.
- **`resetTwoFactor(client: pg.Client, email: string, keys: AuditKeys): Promise<{ userId: string }>`.** In one transaction, in this order:
  - find the user (unknown → `ResetTwoFactorError("unknown_email")`)
  - `update users set two_factor_enabled = false`
  - delete from `two_factors`
  - delete from `verifications` where `identifier like 'trust-device-%' and value = $userId`
  - delete from `sessions`
  - write the `two_factor.reset` row, chained exactly as `make-admin-core.ts` does it (actor null), using `AUDIT_ACTIONS["two_factor.reset"].entityType`

  `reset-two-factor.ts` mirrors `make-admin.ts`: it parses the keys before connecting, and prints only `Two-factor reset for <user id>.` or the error's fixed sentence.
- **`StaffAccess = "guest" | "customer" | "staff" | "needs_two_factor" | "needs_code"`.** `staffAccessFor(actor)`:
  - guest → `guest`
  - not staff, or no permissions → `customer`
  - `!twoFactor.enabled` → `needs_two_factor`
  - `verifiedAt === null` → `needs_code`
  - otherwise `staff`
- **`getSignInState(): "guest" | "needs_code" | "signed_in"`**, a GET server fn in `guard.ts`. `requireSignedIn(location)` is the `beforeLoad` helper:
  - guest → `/login?redirect=`
  - needs_code → `/login/two-factor?redirect=`
  - signed in → returns
- **Routes:**
  - `_staff.tsx` sends `needs_two_factor` to `/account/two-factor?redirect=<href>` (frame 12 is shown there for staff, Task 9) and `needs_code` to `/login/two-factor?redirect=<href>`
  - `account.tsx` calls `requireSignedIn` before its summary

- [ ] **Step 1: Write the failing tests:**
  - **`sessions.int.test.ts`:**
    - `ends every session`: three sessions, then `revoked: 3`, and `getActor` with each old cookie returns `null`
    - `writes sessions.revoked_all with the count and the chain verifies`
    - `a failed audit write rolls back`: pass keys with an unloaded active version. It rejects, all three sessions survive, and no `signed_out_everywhere` event exists.
    - `leaves the database as revokeSessions does`: two users with two sessions each. User A gets `signOutEverywhere`, and user B gets Better Auth's `/revoke-sessions`. The remaining `sessions` rows for both users are 0, the other tables are unchanged (count per table), and the `verifications` rows match.
  - **`auth-config.test.ts`** (unit): `createAuth(...).options` has no `secondaryStorage` and no `databaseHooks.session?.delete`
  - **`reset-two-factor.int.test.ts`:**
    - `turns 2FA off and removes trusted devices and sessions`
    - `writes two_factor.reset with a null actor; the chain verifies`
    - `an unknown email is refused and nothing changes`
  - **`access.int.test.ts` additions:**
    - staff without 2FA → `needs_two_factor`
    - staff owing a code → `needs_code`
    - stamped → `staff`
    - Review Focus 5: roleless staff owing a code → `customer`
  - **`guard.int.test.ts`:**
    - the three `getSignInState` answers from cookies
    - Review Focus 2: `/login/two-factor`'s `beforeLoad` (Task 9) sends a stamped session to `redirect` and a guest to `/login`. Test `challengeRedirect(state, redirect)`, the pure helper it uses: `signed_in` → `safeRedirect(redirect)`, `guest` → `/login`, `needs_code` → `null` (stay).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `vp test --project unit --project integration`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: sign out everywhere in one audited transaction, auth:reset-two-factor, and 2FA-aware guards`

---

### Task 9: The screens

**Prerequisite:** Task 1 approved.

**Files:**
- Create:
  - `src/features/auth/two-factor/ChallengeForm.tsx` (09, 09b, 10)
  - `SetupSteps.tsx` (11a both versions, 11b, 11c)
  - `StaffGate.tsx` (12)
  - `ConfirmDialog.tsx` (13)
  - `codes.ts` (`normaliseTotp`, `normaliseBackupCode`)
  - `two-factor.browser.test.tsx`
  - `codes.test.ts`
  - `src/routes/_auth/login_.two-factor.tsx` (`/login/two-factor`)
  - `src/routes/account_.two-factor.tsx` (`/account/two-factor`)
- Modify: `src/features/auth/LoginForm.tsx` (on `data.twoFactorRedirect`, navigate to `/login/two-factor` with `{ redirect, via: "email", trust: data.kerbTrustDevice }`), `src/features/auth/AccountPage.tsx` (a "Two-factor" link to `/account/two-factor`)

**Interfaces:**
- **`/login/two-factor`** search: `{ redirect?: string; via?: "email"; trust?: boolean; mode?: "backup" }`. Its `beforeLoad` uses `challengeRedirect`.
  - The trust box shows only when `via === "email" && trust === true`.
  - Error mapping from Better Auth codes:
    - `INVALID_CODE` or `INVALID_BACKUP_CODE` → 09b wrong code
    - `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` or `INVALID_TWO_FACTOR_COOKIE` → 09b "Too many tries. Sign in again."
    - 429 → `LoginForm`'s existing too-many-tries notice
  - On success, `navigate({ href: safeRedirect(redirect) })`.
- **`/account/two-factor`** uses `requireSignedIn`.
  - Its loader returns `{ providers, staff, twoFactorEnabled }`. 11a is the password version when `providers` includes `"credential"`, and the Google version otherwise.
  - The Google version calls `authClient.signIn.social({ provider: "google", callbackURL: "/account/two-factor?step=scan" })`.
  - Staff arriving with 2FA off see `StaffGate` (12) first. "Set up two-factor" moves to 11a, and "Log out" signs out.
  - 11b builds the QR with `uqr`'s `renderSVG(totpURI)`. On a coarse pointer (`matchMedia("(pointer: coarse)")`), "Open in authenticator app" (`href={totpURI}`) comes first.
  - 11c's "Done" is disabled until "I've saved these somewhere safe" is ticked. "Download" saves `kerb-backup-codes.txt`.
- **`ConfirmDialog({ open, onConfirmed, onCancel })`** wraps the Phase 2 `Dialog`. It verifies with `authClient.twoFactor.verifyTotp({ code })` and has a "Use a backup code" switch.

- [ ] **Step 1: Write the failing tests:**
  - **`codes.test.ts`:**
    - `normaliseTotp(" 123 456 ")` → `"123456"`
    - `normaliseBackupCode("abcde-12345")` → `"ABCDE-12345"`
    - `normaliseBackupCode("abcde12345")` → `"ABCDE-12345"`
  - **`two-factor.browser.test.tsx`**, with `authClient` mocked as `auth.browser.test.tsx` does:
    - 09: submitting `"123 456"` calls `verifyTotp` with `"123456"`. A wrong code shows the 09b alert, and focus returns to the input.
    - 09b: a used-up challenge shows "Too many tries. Sign in again." and a "Back to log in" link, with no input.
    - Trust box: shown for `via=email&trust=true`, hidden for `trust=false` and with no `via`.
    - 10: shows "Each backup code works once." and normalises input.
    - 11a: password version when `providers=["credential","google"]` (Review Focus 1); Google version when `["google"]`.
    - 11b: the copy button copies the setup key. With a coarse pointer, "Open in authenticator app" comes before the QR in the DOM.
    - 11c: "Done" is disabled until the box is ticked.
    - 12: "Set up two-factor" moves to 11a, and "Log out" calls `signOut`.
    - 13: a right code calls `onConfirmed`, and "Cancel" calls `onCancel`.
    - Review Focus 4: `redirect=//evil.example` navigates to `/account` after success.
- [ ] **Step 2: Run** `vp test --project unit --project component src/features/auth`. Expected: FAIL.
- [ ] **Step 3: Implement** to the approved frames (`get_design_context` on each frame first), with the existing `AuthShell`, `parts.tsx` and form contract (`parseInput`, `fieldErrors`, `focusFirstError`).
- [ ] **Step 4: Run** the same command and `vp check`. Expected: PASS. Then `vp dev` and walk the flows by hand against the local db: sign up, set up, sign out, sign in, challenge, backup code, staff gate.
- [ ] **Step 5: Commit** — `feat: two-factor challenge, backup code, setup, staff gate and confirm dialog screens`

---

### Task 10: E2E, docs, Results and the final checks

**Files:**
- Modify: `e2e/auth.spec.ts`, `e2e/a11y.spec.ts`, `plan/engineering.md` §7, `plan/phases/04-data-auth/phase.md` (4.6 row), `plan/build-plan.md` (4.6 box), `plan/phases/04-data-auth/06-two-factor.md` (status and Results)

- [ ] **Step 1: E2E.**
  - `a staff account without 2FA is sent to set up before any staff page` signs in as `E2E_STAFF_EMAIL` / `E2E_STAFF_PASSWORD`, opens `/staff`, and expects frame 12's heading. It's skipped with a reason when the variables are unset.
  - Add `/login/two-factor` (signed out → redirects to `/login`, so check `/login`) and `/account/two-factor` (staff gate, as above) to the axe checks.
- [ ] **Step 2: Docs.**
  - **engineering.md §7:** 2FA (the stamp, the allowlist, staff rules, freshness, lockout, the plugin-order reason for `kerbTwoFactor()`), sessions ("sign out everywhere", the password change, the cookie cache), and the action list.
  - **`phase.md`:** 4.6 → built.
  - **`build-plan.md`:** the 4.6 box.
- [ ] **Step 3: Results** in the spec, with these known deviations:
  - **Sign-in recording.** `sign_in` after a password moved from `hooks.after` into `kerbTwoFactor()`. Call 10 assumed the plugin had already deleted the half-made session when our hook ran. It hadn't, because user hooks run before plugin hooks.
  - **The `two_factor.disabled` gap** (call 10).
  - **`uqr`** as the QR dependency.
  - **The E2E staff account,** which needs `E2E_STAFF_EMAIL` and `E2E_STAFF_PASSWORD`.
  - Anything else found while building.
- [ ] **Step 4: Run** `vp check`, `vp test` and `vp build`. Expected: all pass. Paste the test counts into Results.
- [ ] **Step 5: Commit** — `docs: 4.6 results; engineering.md 2FA and sessions`
- [ ] **Step 6:** Stop and report to Damion. His steps follow: he sets up 2FA on `dev`, and after the slice reaches staging he opens `/staff` there and is asked for a code. Don't push until he says so.
