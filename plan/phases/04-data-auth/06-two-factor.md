# 4.6 Two-factor authentication and sessions

**Status:** built (approved 6 Nov 2026; branch `slice/4.6-two-factor`, not yet merged; manual and staging checks still to do)
**Phase:** 04-data-auth

## Goal

A stolen password, or a stolen Google account, is no longer enough to reach claims and customer data.

- **Staff must have two-factor (TOTP) on before any staff page loads.** A risky staff action also needs a recent code.
- **Customers can turn two-factor on.** 4.6 builds the server side and the setup and challenge screens. The Settings controls arrive in 6.3.
- **Sessions can be ended.** "Sign out everywhere" ends every session, and a password change or reset ends every other one.
- **Every step leaves a trace.** Two-factor changes and challenges go to `security_events`, and the two that matter most also go to `audit_log`.

This slice also gives the audit log a central, typed list of actions (decision 3).

## Decisions

1. **The scope agreed in `phase.md`** (Damion, earlier):
   - TOTP and backup codes through Better Auth's `twoFactor` plugin
   - optional for customers, required for staff before any staff page
   - a fresh-session check on staff actions
   - "sign out everywhere"
   - sessions revoked on password change
   - setup, removal, backup-code regeneration and challenges go to `security_events`
   - turning 2FA off and "sign out everywhere" also write `audit_log`
2. **Google sign-ins (agreed 4 Nov 2026).**
   - **The Google gap:** Better Auth only asks for the code after an email sign-in, so our own guard sends a Google session that hasn't passed the code check to the challenge (frame 09).
   - **Google-only users:** they turn 2FA on by proving it's them with a fresh Google sign-in instead of a password (`allowPasswordless`), shown as a Google version of frame 11a.
3. **A central, typed list of audit actions** (Damion, 6 Nov 2026).
   - **One file:** every action `audit_log` can record lives in `src/server/audit/actions.ts`, and later slices add theirs there.
   - **Typed:** `audit()` accepts only names from that list, so a typo is a type error. The record type comes from the list, so the two can't disagree.
   - **What moves in:** the three existing actions (`claim.viewed`, `referral.viewed`, `staff.added`).

## Calls I've made (check these)

These calls were settled after a builder read the draft against Better Auth 1.7.15's source. Several fix holes the library leaves open.

4. **"Passed two-factor" is recorded on the session.**
   - **The column:** `sessions` gains `two_factor_verified_at`. It's a Better Auth `additionalFields` entry with `input: false`. Without that, Better Auth's `POST /update-session` would let the browser set the column itself and skip every check below.
   - **It's set only by our `after` hook, after a successful code.** That means `/two-factor/verify-totp` or `/two-factor/verify-backup-code`. Both work for a signed-in session too (the Google challenge and the fresh-session dialog), and in that case they keep the same session.
   - **One exception, the setup step's confirming code.** There the plugin replaces the session with a new one, so the hook stamps `ctx.context.newSession`, never the returned token, which belongs to the deleted session.
   - **A customer's trusted device:** a session created through it counts as verified when it's created. A staff member's never does (call 8).
5. **A session that owes a code can do nothing else.**
   - **When this applies:** the user has 2FA on and the session has no stamp. That covers a Google sign-in, a staff member arriving through an old trusted-device cookie, and a session from before 2FA was turned on.
   - **What's refused:** our `before` hook refuses every Better Auth endpoint except an allowlist:
     - the two verify endpoints
     - `/sign-out`
     - `/get-session`
     - the Google sign-in and callback routes, so the user can sign in again
   - **Why an allowlist:** without this, that session could fetch the TOTP secret (`/two-factor/get-totp-uri`), issue new backup codes or turn 2FA off, which defeats the challenge entirely. An allowlist means a Better Auth endpoint added in a future upgrade starts out refused, not allowed.
   - **Our own reads:** `requireUser` and `requirePermission` refuse such a session with `TWO_FACTOR_CHALLENGE` (401, "Enter your two-factor code to continue."), and the guards send it to frame 09.
6. **The `Actor` learns about two-factor.**
   - **The new field:** `twoFactor: { enabled: boolean; verifiedAt: Date | null }`.
   - **Where it's filled in:** `getActor` reads the session already, so it fills the field in. `resolveActor(db, userId, session?)` takes an optional session, and its existing test callers keep working.
   - **Staff checks:** `requirePermission` (4.5, call 13) refuses staff with 2FA off with `TWO_FACTOR_REQUIRED` (403, "Staff accounts need two-factor. Set it up to continue."), which leads to frame 12. Staff whose session owes a code get `TWO_FACTOR_CHALLENGE`.
7. **What "fresh" means.**
   - **Staff actions:** a code within the last 2 hours.
     - The function is `requireFresh(actor)`, which throws `SESSION_NOT_FRESH` (403, "Confirm it's you to continue.") and leads to frame 13.
     - Why 2 hours: a handler working a queue isn't interrupted every few minutes, and a desk left signed in can't act the next morning. It's GitHub's "sudo mode" length, held in one constant.
     - Reads don't need a fresh code, only the stamp (call 5).
     - **Where it's called:** 4.5c's `defineWrite` has no permission access yet, because 4.5c left that to 6.10. 4.6 doesn't change 4.5c's contract. It builds `requireFresh` and tests it directly, and 6.10 calls it when it gives `defineWrite` its permission access.
   - **Changing 2FA without a password** (a Google-only user turning it on, regenerating codes or turning it off): a session signed in within the last 10 minutes.
     - Our `before` hook checks `session.createdAt`, because the plugin checks nothing here. Better Auth's own `freshAge` is a day.
     - "Continue with Google" on the Google version of 11a creates exactly that new session.
     - A user with a password proves it with the password, as the plugin already requires.
8. **Staff can't trust a device or turn 2FA off.**
   - **What the code does:** a `before` hook removes `trustDevice` from staff verify requests and refuses `/two-factor/disable` for staff with `TWO_FACTOR_REQUIRED`. A session a staff member reaches through an old trusted-device cookie (one issued while they were still a customer) gets no stamp, so the guard challenges them anyway.
   - **What the screen does:** the "Trust this device for 30 days" tick box shows only for customers, and only after an email sign-in. Better Auth only honours the trust cookie there, so on the Google challenge the box would do nothing.
9. **Brute force is capped in every mode.**
   - **Sign-in challenge:** the plugin covers this already.
     - Each challenge allows 5 tries, then is used up. The frame 09b state then becomes "Too many tries. Sign in again."
     - The account locks after 10 wrong codes in a row, for 15 minutes.
   - **Signed-in checks (the Google challenge and the fresh-session dialog):** the plugin skips its lockout here, so our hooks do the same job.
     - The `before` hook refuses a verify while the plugin's `two_factors.locked_until` is in the future.
     - The `after` hook raises `failed_verification_count` on a wrong code and sets `locked_until` at 10, using the same columns. That makes it one lockout across both modes. A good code resets both.
   - **Rate limits:** Better Auth's limiter gets explicit 15-minute rules on `/two-factor/verify-totp` and `/two-factor/verify-backup-code`, 10 tries each. The limiter counts each path separately, by IP. The other two-factor endpoints keep the plugin's own limit.
   - **Code reuse:** a TOTP code can be used again within its 30-second window. Blocking that would need a store of used codes, which isn't worth it on top of the limits above.
10. **What gets recorded.**
    - **New `security_events` types:**
      - `two_factor_enabled`
      - `two_factor_disabled`
      - `backup_codes_regenerated`
      - `two_factor_passed` (method `totp` or `backup_code`)
      - `two_factor_failed`
      - `signed_out_everywhere`
      - `sessions_revoked_on_password_change`
    - **Methods:** `totp` and `backup_code` join `password` and `google` in a generated migration.
    - **When `sign_in` is recorded for a 2FA user:**
      - After an email password with 2FA, the plugin deletes the half-made session and asks for the code. So the existing hook records nothing at the password step.
      - `sign_in` (method `password`) is recorded when the code is accepted, together with `two_factor_passed`.
      - A Google sign-in still records `sign_in` at the callback, as it does now, and `two_factor_passed` later.
    - **New `audit_log` actions:**

      | Action | Entity | `changes` | Actor |
      |---|---|---|---|
      | `two_factor.disabled` | `user` | — | the user |
      | `sessions.revoked_all` | `user` | `{ revoked: <count> }` | the user |
      | `two_factor.reset` | `user` | — | null (the script, call 12) |

    - **How each audit row is written (agreed 6 Nov 2026):**
      - **`sessions.revoked_all` and `two_factor.reset` fail closed.** Both are our own code, so the change and its audit row share one transaction (call 11, call 12).
      - **`two_factor.disabled` is weaker than 4.5b's "fails closed" rule.**
        - Better Auth's `/two-factor/disable` writes outside our transaction. So the audit row is written in the `after` hook, and only on success.
        - The most likely cause of a failed write is missing or malformed audit keys. To rule that out, the `before` hook on `/two-factor/disable` parses the keys (`getAuditEnv()`) and refuses the request with a generic error if they're bad, before anything changes.
        - What's left is a database failure between Better Auth's write and ours. The error is then logged by name, and the `security_events` row still records the change, but `audit_log` has a gap that `verifyAuditChain` can't see.
        - This is accepted because Better Auth owns the change. Replacing its `disable` endpoint would mean copying its password and session checks and keeping them in step with each upgrade. The Results will say so.
11. **Sessions.**
    - **"Sign out everywhere"** is a server function, built here. 6.3 adds its button.
      - It deletes the user's `sessions` rows and writes `sessions.revoked_all` in one `withTx` transaction, so it fails closed. The `security_events` row follows the commit.
      - **Why not Better Auth's `revokeSessions`:** it would put the delete outside our transaction. In 1.7.15 it's `internalAdapter.deleteUserSessions`, which without `secondaryStorage` or a session delete hook (we have neither) is a single delete of the user's rows. So deleting directly does the same thing.
      - Two tests pin that equivalence. An integration test checks that both leave the database the same. A unit test checks that the auth config has no `secondaryStorage` and no `databaseHooks.session.delete`, so adding either fails it and this call gets revisited.
    - **Password change:** a `before` hook forces `revokeOtherSessions: true`, whatever the browser sends.
      - Better Auth then deletes every session, the current one included, and signs the user in again with a new one.
      - Our `after` hook copies the old session's `two_factor_verified_at` onto `ctx.context.newSession`, so a staff member isn't asked for a code straight after changing their password.
    - **Password reset:** it already ends every session (`revokeSessionsOnPasswordReset: true`, set in 4.4).
    - **Recording:** both cases record `sessions_revoked_on_password_change`.
    - **The cookie cache:**
      - Better Auth's 5-minute cookie cache (4.4) means another device may look signed in to Better Auth's cached `getSession` for up to 5 minutes after its session is revoked.
      - All our data reads go through `getActor`, which bypasses the cache, so nothing is readable in that window.
      - The tests check through `getActor`.
12. **A staff member who loses both their phone and their backup codes.**
    - **The script:** `vp run auth:reset-two-factor <email>`, in the `auth:make-admin` style. It turns their 2FA off, clears their trusted devices, ends their sessions, and writes `two_factor.reset` in one transaction.
    - **Why:** otherwise a locked-out admin (today, only Damion) has no way back before 6.8's admin screens.
    - **After the reset:** the next staff page sends them to setup.
13. **The audit action list.**
    - **The file:** `src/server/audit/actions.ts` imports nothing, so the scripts load it as `../src/server/audit/actions.ts`.
    - **Its contents:** `AUDIT_ACTIONS = { "<area.verb>": { entityType, description } } as const`, and `type AuditAction = keyof typeof AUDIT_ACTIONS`.
    - **How `audit()` uses it:** `audit()` takes `action: AuditAction` and gets `entityType` from the list. The script writers use the same list.
    - **Tests:** a snapshot pins it, like `ROLE_PERMISSIONS`.
    - **The database:** keeps only its `area.verb` format check, so adding an action never needs a migration. `verifyAuditChain` keeps accepting any name, because history can hold retired ones.
    - **`description`** is plain English, ready for 6.8's audit viewer.
14. **The guards.**
    - **Customer pages:** there's no shared signed-in guard today, only `/account`'s own. 4.6 adds one helper the signed-in pages call, which sends a session owing a code to frame 09.
    - **Staff pages:** the `_staff` guard's `getStaffAccess()` gains two answers, `needs_two_factor` (frame 12) and `needs_code` (frame 09).

## In scope

### Screens (Figma, `Account · Web (two-factor)`, node `205:4701`)

| Frame | What 4.6 builds |
|---|---|
| 09, 09b | The challenge page `/login/two-factor`. It has the code input and the wrong-code state, plus the "too many tries" state (call 9). The trust tick box shows only for customers after an email sign-in (call 8). It links to "Use a backup code instead". |
| 10 | The backup-code form (`XXXXX-XXXXX`), with "Each backup code works once." |
| 11a | Setup step 1, "Confirm it's you": the password field. For a Google-only user it's the Google version: "Continue with Google", which signs them in again and returns to step 2. |
| 11b | Setup step 2: the QR code, the setup key with a copy button, the code input and "Turn on two-factor". On mobile, "Open in authenticator app" (an `otpauth://` link) comes first. |
| 11c | Setup step 3: 10 backup codes, "Download" and "Copy", and "I've saved these somewhere safe" gating "Done". |
| 12 | The staff gate: "Staff accounts need two-factor", with "Set up two-factor" or "Log out". |
| 13 | The "Confirm it's you" dialog, a component that 6.10 and 6.11 open. In 4.6 it's covered by a component test. |

- **Not in Figma yet:**
  - the Google version of 11a
  - the mobile "Open in authenticator app" link on 11b
  - 09b's "too many tries" state

  4.3 decided that every 4.4–4.6 screen is designed and approved in Figma before its code. So these are designed first, as the first step after this spec.
- **Setup page:** `/account/two-factor` (11a–11c) is an auth-layout page. Staff reach it from frame 12, and customers from a link on `/account` until 6.3's Settings reuses the steps.

### Server

- **Plugin options:** issuer "Kerb", `allowPasswordless: true`, the 30-day trusted device, and the lockout left on.
- **Rate-limit rules:** the two verify-path rules (call 9).
- **`before` hooks:**
  - the session-owes-a-code allowlist (call 5)
  - the 10-minute freshness check for changes without a password (call 7)
  - the staff restrictions (call 8)
  - the signed-in lockout check (call 9)
  - forced `revokeOtherSessions` (call 11)
  - the audit-key check on `/two-factor/disable` (call 10)
- **`after` hooks:**
  - stamping (call 4)
  - the signed-in lockout counting (call 9)
  - copying the stamp after a password change (call 11)
  - recording (call 10)
- **`Actor`, `requireUser`, `requirePermission` and `requireFresh`** (calls 5–7). The three new error codes join `AuthzCode`, and 4.5c's `PublicError` adapter carries them to the browser.
- **The guards** (call 14).
- **"Sign out everywhere"** (call 11), in one `withTx` transaction with its audit row.
- **`scripts/reset-two-factor.ts`** and its core (call 12).
- **The audit action list** (call 13), with `audit()`, `make-admin-core.ts` and the two staff reads using it.

### Schema (generated migration)

- `sessions.two_factor_verified_at` (`timestamptz`, nullable).
- `security_events`: the new types and methods.
- The data contract: the new column is `drop`, like `sessions`' other columns.

## Out of scope

- **6.3:** the Settings controls for turning 2FA off, regenerating backup codes, "sign out everywhere" and "Recent activity".
- **6.8:** resetting someone else's 2FA from a screen. Until then, the script covers it.
- **6.10:** calling `requireFresh` from real staff writes.
- **Not planned:** passkeys, SMS or email codes, mandatory 2FA for customers, and a store of used TOTP codes (call 9).

## What you set up

- **Approve the three missing Figma states**, which are designed first (see Screens).
- **After the slice lands on staging, set up 2FA on your own admin account.** `/staff` will send you there. Keep the backup codes somewhere safe, such as a password manager. Losing both your phone and your backup codes means running `auth:reset-two-factor` against that database.
- **No new environment variables for the app.** For the E2E staff test: a staff account with a password and 2FA off on `dev`, in the `E2E_STAFF_EMAIL` and `E2E_STAFF_PASSWORD` Actions secrets. Without them that test is skipped.

## Steps

- [x] You approve this spec
- [x] The three missing Figma states, designed and approved
- [x] The audit action list, and `audit()`, the scripts and the staff reads on it
- [x] The migration, the plugin options and the rate-limit rules
- [x] The hooks (calls 4, 5, 7–11)
- [x] `Actor`, `requireUser`, `requirePermission`, `requireFresh` and the error codes
- [x] The guards and the screens
- [x] "Sign out everywhere" and `auth:reset-two-factor`
- [x] Docs:
  - engineering.md §7 (2FA, sessions, the action list)
  - `phase.md`
  - `build-plan.md`
- [x] `vp check`, `vp test`, `vp build`
- [ ] Your 2FA on `dev`, then a run on staging

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | `AUDIT_ACTIONS` snapshot; every name matches `area.verb`; an unknown name is a type error (`@ts-expect-error`) | yes |
| Unit | The auth config has no `secondaryStorage` and no session delete hook (call 11) | yes |
| Integration | The stamp: the browser can't set `two_factor_verified_at` through `/update-session`; a sign-in code, a signed-in code and the setup code each stamp the session that survives | yes |
| Integration | A session owing a code (Google sign-in with 2FA on): refused by every non-allowlisted Better Auth endpoint (at least `get-totp-uri`, `generate-backup-codes`, `disable`, `change-password`, `revoke-sessions`) and by our reads; after a code, allowed | yes |
| Integration | Staff: 2FA off → `TWO_FACTOR_REQUIRED`; owing a code → `TWO_FACTOR_CHALLENGE`; `trustDevice` stripped; `disable` refused; an old trust cookie still leads to a challenge | yes |
| Integration | `requireFresh`: a code 2 hours old → `SESSION_NOT_FRESH`; a recent one → allowed. A Google-only user changing 2FA needs a session under 10 minutes old; a password user needs the password | yes |
| Integration | Lockout: 5 wrong codes use up a sign-in challenge; 10 in a row lock code checks for 15 minutes in both modes, and a good code resets the count; the verify rate limit refuses the 11th try | yes |
| Integration | Recording: each 2FA event writes its `security_events` row (no IP, no email); `sign_in` is recorded once, after the code; `two_factor.disabled` and `sessions.revoked_all` write `audit_log`, and the chain verifies; with bad audit keys, `disable` is refused and 2FA stays on; a failed audit write rolls back "sign out everywhere" (the sessions survive) | yes |
| Integration | Sessions: "sign out everywhere" ends every session (checked through `getActor`), and leaves the database as Better Auth's `revokeSessions` does (the equivalence test); a password change ends the others and keeps the user signed in and verified; a reset ends all | yes |
| Integration | `auth:reset-two-factor`: 2FA off, trusted devices and sessions gone, `two_factor.reset` written; an unknown email is refused | yes |
| Component | 09/09b (wrong code, too many tries, trust box only where it applies), 10, 11a (both versions), 11b (copy, mobile link first), 11c ("Done" gated), 12, 13 | yes |
| E2E | A staff account without 2FA is sent to frame 12 before any staff page; axe on each new page | yes |
| Manual | You set up 2FA on `dev`, then open `/staff` on staging: you're asked for a code, then let in | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] On staging, your admin can't reach `/staff` without 2FA, and a Google sign-in is asked for its code.
- [x] Every `audit()` call names an action from `AUDIT_ACTIONS`.

## Commit message

`feat: two-factor for staff and customers, the Google challenge, fresh-session checks, sign out everywhere, and a typed list of audit actions`

## Sources

- **Plan docs:** `phase.md` (the 4.6 row and its tests); engineering.md §7.
- **Earlier specs:**
  - 03-auth-screens.md: frames 09–13, decision 5, "For 4.6".
  - 04-better-auth.md: hooks, `security_events`, rate-limit rules.
  - 05-authorization.md: call 13.
  - 05b-audit-integrity.md: `audit()`, and the scripts' `chain.ts` pattern.
  - 05c-safe-write-tools.md: `defineWrite` (its permission access waits for 6.10), and `PublicError`'s adapter.
- **Better Auth 1.7.15 source**, checked by the builder review:
  - `plugins/two-factor/{index,verify-two-factor,totp/index,backup-codes/index}.mjs`
  - `api/routes/{session,password,update-session}.mjs`
  - `api/dispatch.mjs`, for hook order (our hooks run before the plugin's)

## Results (6 Nov 2026, before the PR)

Changes from the spec:
- **`sign_in` after a password moved into `kerbTwoFactor()`**, a Kerb plugin registered straight after `twoFactor()`, instead of `hooks.after`. Call 10 assumed `twoFactor()` had already deleted the half-made session when our hook ran. It hadn't: Better Auth runs `hooks.before`/`hooks.after` from the options first, then plugin hooks in plugin order (`api/dispatch.mjs`), so the hook in `auth.ts` saw the doomed session and would have recorded a `sign_in` for it. The Sources line below ("our hooks run before the plugin's") states the same fact; call 10 drew the wrong conclusion from it. All the 4.6 hooks live in the plugin, the `/change-password` one included, so the hand-off between them has one owner.
- **The allowlist also admits `/oauth-proxy-callback`** (with `/sign-in/social` and `/callback/*`), because previews finish a Google sign-in through the OAuth proxy, and call 5 lets the user sign in again with Google.
- **The allowlist check falls back to the cookie-cached session when the database row is gone.** Without it, a session owing a code could call `/sign-out` (allowed), keep its old cookies and replay them: our database lookup found nothing and let the request through, and the endpoint then served the cached copy (for up to 5 minutes), so `/list-sessions` answered 200. A cached-only copy is refused like a live one and its wrong codes count towards the lockout, but it's never stamped.
- **Extra refusals in the before hook:**
  - a backup code can't confirm setup: `400 TWO_FACTOR_NOT_ENABLED`. Better Auth would accept one from the unconfirmed enrolment and the session would be stamped without 2FA being on.
  - `disableSession: true` on either verify path: `400 DISABLE_SESSION_NOT_ALLOWED`. Kerb always wants the session a code makes or keeps.
  - an error in our own lookups fails closed: logged by name, generic 500. In the `/sign-in/email` after hook a failed staff lookup counts as staff (no stamp, no tick box).
- **Backup codes are ten `XXXXX-XXXXX` from `[A-Z0-9]`** (`customBackupCodesGenerate`). Better Auth's default mixes case (`t5BmW-RpUjm`) and compares exactly, so the form's upper-casing would have refused nearly every real code. About 51 bits per code. No account had 2FA before 4.6, so no existing codes break.
- **Files split out, and why:**
  - `src/server/auth/two-factor-events.ts`: the audit-key check, the `two_factor.disabled` row and the password-change stamp copy, to keep `two-factor.ts` near 450 lines.
  - `src/features/auth/sign-in-state.ts`: `readSignInState`. While it sat in `guard.ts`, a dynamic import in a plain function shipped `actor`, `auth`, `client` and `schema` chunks to the browser. The server function's handler now imports it, and Start strips that body from the client.
  - `src/features/auth/two-factor/gate.ts`: who may stay on `/login/two-factor`. In sign-in mode there's no session yet, only Better Auth's `two_factor` cookie, so a guest coming from the log-in form (`via=email`) stays and any other guest goes to `/login`. The route file is `login_.two-factor.tsx`, not nested under `/login`, whose guard reads the cached session.
  - `signOutEverywhereNow(actor, headers?)` wraps `signOutEverywhere(db, …)` with `getDb()`, because lint bans the db client from `src/features/`. `signOutEverywhere` also takes `keys` (default `getAuditEnv()`) so the rollback test can pass bad ones.
- **Two dependencies:** `uqr` (0.1.3) draws the QR code as SVG. `@better-auth/utils` (0.5.1) is a pinned devDependency for the test TOTP helper (pnpm's strict layout hides Better Auth's copy); a Better Auth bump needs it to follow Better Auth's own version.
- **The E2E staff test needs a dedicated staff account** on `dev`, in the `E2E_STAFF_EMAIL` and `E2E_STAFF_PASSWORD` Actions secrets (`e2e.yml` passes them through). Without them the test is skipped with that reason. It hasn't run yet: the secrets don't exist. Signed out, `/login/two-factor` lands on `/login` and `/account/two-factor` on `/login?redirect=…`, so their axe checks run there; the staff gate (12) is checked signed in, in the staff test.
- **Smaller ones:**
  - the plugin's `accountLockout` reads the shared constants (equal to its defaults), so both halves of the lockout use one value
  - every wrong code records `two_factor_failed`, sign-in mode included; a used-up challenge or a lock refusal checked no code and records nothing
  - the setup code records `two_factor_enabled` and `two_factor_passed` (`totp`)
  - "no password" for call 7 is the plugin's own test (no credential account, or one with a null password)
  - `auth:reset-two-factor` prints `Failed: <name> (<SQLSTATE>)` for an unexpected error, never its message, which can hold the email
  - frame 13 takes an optional `description` (6.10 passes its own) and has a "Use a backup code" link the frame doesn't show
  - `/account` has a "Two-factor" panel (On / Off, with "Set up two-factor") in the "Ways to log in" style; it wasn't designed in Figma

What was built:
- Server: `src/server/auth/two-factor.ts` (`kerbTwoFactor()`: the stamp, the allowlist, staff rules, passwordless freshness, the signed-in lockout, recording, the forced `revokeOtherSessions`), `two-factor-events.ts`, `two-factor-constants.ts`, `sessions.ts` (`signOutEverywhere`). `actor.ts`: `Actor.twoFactor`, `requireUser` and `requirePermission` with `TWO_FACTOR_CHALLENGE` and `TWO_FACTOR_REQUIRED`, `requireFresh` with `SESSION_NOT_FRESH`. `auth.ts`: the plugin options, the verify rate limits, the backup-code format. `src/server/audit/actions.ts` (`AUDIT_ACTIONS`, `AuditAction`), with `audit()` taking its entity type from it.
- Schema: `drizzle/0011_normal_quasimodo.sql` (`sessions.two_factor_verified_at`; the new `security_events` types and methods); the data contract marks the column `drop`.
- Scripts: `vp run auth:reset-two-factor <email>` (`scripts/reset-two-factor{,-core}.ts`); `make-admin-core.ts` on the action list.
- Guards: `getSignInState`, `requireSignedIn` and `challengeRedirect` (`src/features/auth/guard.ts`); `getStaffAccess` answers `needs_two_factor` and `needs_code`; `/account` uses `requireSignedIn`.
- Screens: `/login/two-factor` (09, both 09b states, 10), `/account/two-factor` (12, both versions of 11a, 11b with the mobile link first, 11c), `ConfirmDialog` (13). `signOutEverywhereFn` is ready for 6.3's button.
- Docs: engineering.md §7 (Two-factor and sessions; the action list), `phase.md`, `build-plan.md`.
- E2E: the staff-gate test with axe at 390 and 1440 px; `/login/two-factor` and `/account/two-factor` in `a11y.spec.ts`.
- Tests: 941 passing (`vp test`, 68 files): 366 unit, 383 integration, 192 component. Integration covers the stamp in all three modes and `/update-session` refusing it; the allowlist (eight refused endpoints, the replayed cached cookie); staff rules; both freshness rules; the lockout across modes and the verify rate limit; every recorded event, the two audit rows and the chain; bad audit keys refusing `disable`; sign out everywhere (rollback, and the equivalence with `/revoke-sessions`); the password change and reset; `auth:reset-two-factor`; the guards. Unit covers the action list, the auth config, `requireFresh`, the codes, the challenge gate and `safeRedirect`. Component covers frames 09–13, and the confirm dialog starting clean each time it opens.

Known limits:
- **The `two_factor.disabled` gap** (call 10): a database failure between Better Auth's write and ours turns 2FA off with a `two_factor_disabled` event but no `audit_log` row, which `verifyAuditChain` can't see. Bad keys are refused first, so this needs the database to fail mid-request.
- **Parallel signed-in guesses can race the lock check:** several verifies can all pass the before hook before any is counted. The per-IP limit (10 per 15 minutes on each verify path) bounds it. The plugin's sign-in lockout has the same race.
- **The cookie cache shows a null stamp for up to 5 minutes** after a code, because the `session_data` cookie is written before our after hook stamps. Nothing gates on it: the guards and the data layer use `getActor`.
- **`/login`'s guard still uses the cached session**, so for up to 5 minutes after "sign out everywhere" on another device, a browser with the old cookies may take one extra hop between `/login` and `/account`. It shouldn't loop: on a database miss Better Auth's get-session deletes the session cookie and `tanstackStartCookies` forwards that, so the first `getActor` miss should clear the stale cookie. To be confirmed during the manual walk.
- **Staff with no roles, and deactivated staff, are customers to the 2FA rules:** they can tick "Trust this device", get a trusted-device stamp and turn 2FA off. They can't reach anything staff can. If roles come back, `requirePermission` asks for 2FA again only when 2FA is off.
- **A session stamped without a code can become a staff session.** A customer with 2FA on who signs in through a trusted device gets a stamped session without a code (call 4). If `auth:make-admin` promotes them, or a roleless or deactivated staff member gets roles back, that session passes the staff guard (and `requireFresh` for 2 hours) without a code ever being entered. See the follow-ups.
- **The owing check fails open on one narrow error.** It reads the session with `getSessionFromCtx`, which turns a database error into null. A transient error on our lookup while the endpoint's own lookup succeeds could let one request through. It needs both in the same request.
- **While a code is owed, `/request-password-reset`, `/reset-password` and `/verify-email` are refused too** (`401 TWO_FACTOR_CHALLENGE`; ruling R13). "Not you? Log out" on the challenge is the way out.
- **Turning 2FA off with only an unconfirmed enrolment** (2FA already off) still records `two_factor_disabled` and writes a `two_factor.disabled` row. Harmless, slightly noisy.

Still to do:
- **Damion's manual walk on `dev`:** sign up, set up 2FA, sign out, sign in, the challenge, a backup code, the staff gate, and the Google `step=scan` round trip and the 10-minute window, which so far are covered only by mocks and integration tests. `0011` has to be on `dev` first (`vp run db:migrate`, or staging's build).
- **Then his own 2FA on `dev`, and the staging check:** `/staff` asks for a code, then lets him in, and a Google sign-in is asked for its code.
- **The E2E staff account:** a dedicated account on `dev` that signs up normally with a password and confirms its email, then `auth:make-admin` makes it staff. Leave its 2FA off, or the test fails rather than skips. Then `E2E_STAFF_EMAIL` / `E2E_STAFF_PASSWORD` in the repo's Actions secrets. The staff-gate E2E skips until they exist.
- **Before applying `0011` on staging and production,** run `select count(*) from users where two_factor_enabled` and confirm it's 0. The upper-case backup-code format assumes no earlier enrolments.
- **Follow-ups:**
  - `auth:make-admin` prints a raw `Failed: <message>` and the email on success (pre-existing, 4.5; ruling R11). It should print as `auth:reset-two-factor` does.
  - `auth:make-admin` and 6.8's role grants should delete the user's sessions in the same transaction, so a session stamped without a code can't carry the new roles.
  - 6.8 should align the three staff checks (`isStaff` in `two-factor.ts`, `staffAccessFor`, and `requirePermission`'s `TWO_FACTOR_REQUIRED`) on one rule: `actor.staff != null`.
  - `safeRedirect` accepted `/\evil.example` and `/<tab>/evil.example`, which URL parsing reads as another site (pre-existing). Hardened in 4.6: it now refuses backslashes and control characters, and the path must resolve on our own origin. TanStack's router already blocked those redirects.

**Final review (6 Nov 2026):** ready, with fixes. Fixed in the review commit: `ConfirmDialog` resets its mode, input, error, notice and lockout each time it opens (one lockout used to leave every later opening with a disabled Confirm); `safeRedirect` as above; these Results corrections. Left for later slices:
- 6.3: skip `two_factor.disabled` (the event and the audit row) when 2FA was already off, carrying `wasEnabled` in the `kerb2fa` hand-off, before the disable button ships; and a notice when the Google confirm comes back stale or 5xx.
- 6.8: delete sessions on role grants, and the one staff rule.
- 6.10: the 10-verifies-per-15-minutes-per-IP limit may be tight for an office behind one NAT once the confirm dialog is in use.
- Minor polish left as is: focus on the locked and used-up challenge states, "Back to log in" keeps no `?redirect=`, the backup-code hint is hidden while an error shows.
