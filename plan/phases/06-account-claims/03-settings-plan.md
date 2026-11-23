# 6.3 Account settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/account/settings` becomes Personal details (with an editable mobile) and `/account/settings/security` becomes Security (ways to log in, 2FA on/off, sign out everywhere, recent activity, close account), built to Figma Account · Settings.

**Architecture:** Pure helpers (mobile rule, activity labels and times) in `src/features/account/settings-model.ts`. Two reads and one write in a new `src/server/data/settings.ts`, declared with `defineRead`/`defineWrite` so the permission suite covers the reads and the write gets `withIdempotency`. Server functions in `src/features/account/settings.ts`. The UI is a `SettingsLayout` (section nav) holding `PersonalDetails` or `SecuritySection`; 2FA off calls Better Auth's `authClient.twoFactor.disable` (4.6's hooks already audit it) and sign out everywhere calls 4.6's `signOutEverywhereFn`.

**Tech Stack:** TanStack Start (routes, server functions), Drizzle + Postgres, Better Auth, Vitest (`vp test`: unit, integration and browser projects), Playwright.

**Spec:** [03-settings.md](03-settings.md). Figma Account · Settings `182:3249`: 01 `182:3254`, 02 `182:3358`, 06 Security `276:3822`, 07 Turn off two-factor `276:3885`, 08 Sign out everywhere `276:3900`.

## Global Constraints

- Branch `slice/6.3-settings` (made from `staging`). Stage files by name, never a folder. `plan/phases/07-kerbie/phase.md` is Damion's uncommitted work: never stage it.
- Every commit ends with both lines:
  `Co-authored-by: Opsed Solutions [www.opsedsolutions.com] <damionwilson@opsedsolutions.com>`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Don't run browser tests or `vp build` while `vp dev` is running.
- Both pages send `Cache-Control: private, no-store` and use `requireSignedIn`.
- Copy is verbatim from the spec. Personal details: "Full name", "Date of birth", "Email address", "Mobile number", "Home address", "Not added", "Edit details", "Save changes", "Cancel", "To change your legal name, call us. We'll need to update your policy too.", "To change your email, contact us.", "Enter a UK mobile number, like 07700 900418", "We couldn't save your mobile number. Try again." Security: "Security", "Ways to log in", "Two-factor", "On", "Off", "Turn on", "Turn off", "You'll enter a code from your authenticator app when you log in.", "Add a code from an authenticator app when you log in.", "Staff accounts keep two-factor on.", "Sign out everywhere", "Signs you out on every device, including this one.", "Recent activity", "No activity yet.", "Close your account". Dialog 07: "Turn off two-factor?", "Anyone with your password will be able to log in without a code.", "Password", "Turn off two-factor", "That password isn't right.", "For your security, confirm with Google first." Dialog 08: "Sign out everywhere?", "You'll be signed out on every device, including this one. You'll need to log in again." Login notice: "You've been signed out on every device."
- Activity labels and the warning set are the spec's decision 7, word for word.
- Times and dates are Europe/London.
- The phone number never goes into `audit_log`, `security_events` or logs.
- Not in 6.3: address change, drivers, cover, `policy_versions` (6.3b); name/email change; Notifications and Communication preferences; backup-code regeneration; per-session sign-out.

## Review Focus

1. **A user with no customer row** (signed up, never quoted): Personal details shows name (from the user) and email only, no "Edit details"; `updateMyPhone` is refused with a message, not a 500. Tests in Task 2 and Task 4.
2. **Clearing the mobile** (empty input): saves `null`, shows "Not added", audits `{ set: false }`. Tests in Task 1 and Task 2.
3. **A retried save after the first committed** (same idempotency key): one update, one audit row, same response. Test in Task 2.
4. **A Google-only account turning 2FA off with a stale session:** `SESSION_NOT_FRESH` shows the "confirm with Google" state instead of a generic error, and the badge goes back to "On". Test in Task 5.
5. **Old Google-link callbacks** (`/account/settings?linked=google` and `?error=link`): land on Security with the toast, not a silent Personal details. Test in Task 7 (the redirect lives in the route's `beforeLoad`).

---

### Task 0: Commit the spec and the split

**Files:** `plan/phases/06-account-claims/03-settings.md`, `plan/phases/06-account-claims/03-settings-plan.md`, `plan/phases/06-account-claims/phase.md`, `plan/build-plan.md`.

- [ ] **Step 1:** `git add` those four files by name and commit `docs(account): 6.3 account settings spec and plan; policy changes split out as 6.3b` with the two trailers.

---

### Task 1: The settings model (mobile rule, activity labels, "when")

**Files:**
- Create: `src/features/account/settings-model.ts`
- Test: `src/features/account/settings-model.test.ts`

**Interfaces:**
- Produces:
  - `mobileSchema: z.ZodType<string | null, string>`: trims; `""` → `null`; otherwise strips spaces, accepts `07\d{9}` or `+447\d{9}` (a `+44 7…` form becomes `07…`), and outputs `"07700 900418"` (5 digits, space, 6). Error message `"Enter a UK mobile number, like 07700 900418"`.
  - `activityLabel(type: SecurityEventType, method: string | null): string`: the spec's labels; `sign_in` with method `"google"` → `"Signed in with Google"`.
  - `isWarningActivity(type: SecurityEventType): boolean`: true for `sign_in_failed`, `rate_limited`, `two_factor_failed`, `google_link_refused`.
  - `activityWhen(at: Date, now: Date): string`: London time. Under 60 minutes: `"{n} minutes ago"` (`"1 minute ago"`, `"Just now"` under one minute); same London day: `"{n} hours ago"` (`"1 hour ago"`); previous London day: `"Yesterday, HH:mm"`; otherwise `"12 Nov 2026"`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("mobileSchema", () => {
  it.each([
    ["07700 900418", "07700 900418"],
    ["07700900418", "07700 900418"],
    ["+44 7700 900418", "07700 900418"],
    ["+447700900418", "07700 900418"],
    ["  ", null],
  ])("%s → %s", (raw, out) => expect(mobileSchema.parse(raw)).toBe(out));
  it.each(["020 7946 0018", "0770090041", "077009004181", "07700 9OO418", "+33 612345678"])(
    "refuses %s",
    (raw) => expect(mobileSchema.safeParse(raw).error?.issues[0]?.message).toBe(
      "Enter a UK mobile number, like 07700 900418",
    ),
  );
});

describe("activityLabel", () => {
  it.each(SECURITY_EVENT_TYPES)("%s has a label", (type) => {
    expect(activityLabel(type, null)).toMatch(/^[A-Z]/);
  });
  it("names Google sign-ins", () => expect(activityLabel("sign_in", "google")).toBe("Signed in with Google"));
  it("plain sign-in", () => expect(activityLabel("sign_in", "password")).toBe("Signed in"));
});

it("warning set", () => {
  expect(new Set(SECURITY_EVENT_TYPES.filter(isWarningActivity))).toEqual(
    new Set(["sign_in_failed", "rate_limited", "two_factor_failed", "google_link_refused"]),
  );
});

describe("activityWhen (London)", () => {
  const now = new Date("2026-11-22T15:00:00Z"); // 15:00 London (GMT)
  it.each([
    ["2026-11-22T14:59:40Z", "Just now"],
    ["2026-11-22T14:59:00Z", "1 minute ago"],
    ["2026-11-22T14:12:00Z", "48 minutes ago"],
    ["2026-11-22T14:00:00Z", "1 hour ago"],
    ["2026-11-22T00:05:00Z", "14 hours ago"],
    ["2026-11-21T21:14:00Z", "Yesterday, 21:14"],
    ["2026-11-12T09:00:00Z", "12 Nov 2026"],
  ])("%s → %s", (at, out) => expect(activityWhen(new Date(at), now)).toBe(out));
  it("uses the London day in summer time", () => {
    // 23:30 UTC on 1 Jul is 00:30 on 2 Jul in London: "today" for a 2 Jul noon now
    expect(activityWhen(new Date("2026-07-01T23:30:00Z"), new Date("2026-07-02T11:00:00Z"))).toBe("10 hours ago");
  });
});
```

- [ ] **Step 2:** `vp test run src/features/account/settings-model.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the four exports in `settings-model.ts`. The labels are a `Record<SecurityEventType, string>` (so a new type fails to compile); London dates via `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" })`, as the account's other date helpers do.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(account): settings model: the mobile rule, activity labels and times`.

---

### Task 2: The settings data (two reads, one write)

**Files:**
- Create: `src/server/data/settings.ts`
- Modify: `src/server/data/index.ts` (export `./settings`), `src/server/audit/actions.ts` (add `"customer.phone_changed": { entityType: "customer", description: "A customer added, changed or removed their mobile number" }`), `src/server/audit/__snapshots__/actions.test.ts.snap` (update with `vp test run src/server/audit/actions.test.ts -u`), `src/server/data/permissions.int.test.ts` (two `cases` rows)
- Test: `src/server/data/settings.int.test.ts`

**Interfaces:**
- Consumes: `mobileSchema` (Task 1).
- Produces:
  - `getMyPersonalDetails: DataRead<{}, PersonalDetails>` with `access: "signed_in"`, where
    `PersonalDetails = { name: string; email: string; customer: { firstName: string; lastName: string; dateOfBirth: string; phone: string | null; addressLine1: string; addressLine2: string | null; town: string; postcode: string } | null }` (`name`, `email` from `users`; `customer` null without `actor.customerId`).
  - `getMyRecentActivity: DataRead<{}, RecentActivity[]>`, `RecentActivity = { type: SecurityEventType; method: string | null; device: string | null; at: string }` (ISO), the 10 newest for `actor.userId`, newest first. Selects only those columns: no `ipHash`.
  - `updateMyPhone: DataWrite<{ phone: string | null }>` = `defineWrite(z.object({ phone: mobileSchema }), { idempotent: { action: "account.update_phone" } }, run)`. `run`: no `actor.customerId` → `rejected("Save a quote first to add a mobile number.")`; else update `customers.phone` (and `updatedAt`), `audit(tx, { actor, action: "customer.phone_changed", entityId: customerId, changes: { phone: { set: phone !== null } } })`, return `{ phone }`.

- [ ] **Step 1: Write the failing integration tests** in `settings.int.test.ts` (same setup as `policies.int.test.ts`: `truncateAll`, the factories in `src/test/`):
  - `getMyPersonalDetails` for a customer returns their name, email, date of birth, `phone: null` and address; for a user without a customer row returns `customer: null` with the user's name and email.
  - `getMyRecentActivity` returns only this user's events (insert 12 for A, 2 for B), 10 of them, newest first, and no key named `ipHash` on any row.
  - `updateMyPhone(actorA, { input: { phone: "+44 7700 900418" }, idempotencyKey: K }, ctx)` → `{ ok: true, data: { phone: "07700 900418" } }`; the row has it; one `audit_log` row `customer.phone_changed` whose `changes` is `{ phone: { set: true } }` and whose JSON doesn't contain `"7700"`.
  - Same call again with key `K`: same result, still one audit row.
  - Key `K` with a different phone: `{ ok: false }` (the idempotency mismatch), row unchanged.
  - `{ phone: "" }` with a new key → `data.phone === null`, audit `{ set: false }`.
  - `{ phone: "020 7946 0018" }` → `{ ok: false, error: { fields: { phone: "Enter a UK mobile number, like 07700 900418" } } }`, nothing written.
  - A user without a customer row → `{ ok: false, error: { message: "Save a quote first to add a mobile number." } }`.
  - Signed out (`null` actor) → throws `AuthzError("UNAUTHENTICATED")` (whatever code `requireUser` throws; match `define.int.test.ts`).
- [ ] **Step 2:** `vp test run src/server/data/settings.int.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `settings.ts`; add the audit action and snapshot; export from `index.ts`; add `{ read: data.getMyPersonalDetails, input: () => ({}), owner: null }` and `{ read: data.getMyRecentActivity, input: () => ({}), owner: null }` to the permission suite's `cases`.
- [ ] **Step 4:** `vp test run src/server/data/settings.int.test.ts src/server/data/permissions.int.test.ts src/server/audit/actions.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(account): personal details, recent activity and the mobile save, audited and idempotent`.

---

### Task 3: Server functions and the missing 2FA test

**Files:**
- Create: `src/features/account/settings.ts`
- Modify: `src/server/auth/two-factor.int.test.ts` (one test)

**Interfaces:**
- Consumes: Task 2's reads and write.
- Produces (all with `actorMiddleware`, server modules imported inside the handler, as `src/features/account/policies.ts`):
  - `getMyPersonalDetailsFn` (GET) → `PersonalDetails`
  - `getMyRecentActivityFn` (GET) → `RecentActivity[]`
  - `updateMyPhoneFn` (POST), validator passes `{ input: { phone: string }, idempotencyKey: string }` through → `WriteResult<{ phone: string | null }>`, calling `updateMyPhone(context.actor, data, { headers: getRequestHeaders() })`.

- [ ] **Step 1:** In `two-factor.int.test.ts`, next to "turning 2FA off writes two_factor.disabled…", add `it("disable with the wrong password changes nothing and records nothing")`: a password user with 2FA on calls `/two-factor/disable` with a wrong password → error; `twoFactorEnabled` still true; no `two_factor_disabled` event; no `two_factor.disabled` audit row.
- [ ] **Step 2:** `vp test run src/server/auth/two-factor.int.test.ts`. Expected: PASS (Better Auth already refuses; this pins it for 6.3's dialog). If it fails, stop and report.
- [ ] **Step 3:** Write `settings.ts` with the three server functions.
- [ ] **Step 4:** `vp check`. Expected: no errors.
- [ ] **Step 5:** Commit `feat(account): settings server functions; pin 2FA disable with a wrong password`.

---

### Task 4: Settings layout and Personal details

**Files:**
- Create: `src/features/account/SettingsLayout.tsx`, `src/features/account/PersonalDetails.tsx`, `src/features/account/settings.css`
- Test: `src/features/account/settings.browser.test.tsx`

**Interfaces:**
- Consumes: `PersonalDetails` type, `updateMyPhoneFn` (Task 3), `mobileSchema` (Task 1).
- Produces:
  - `SettingsLayout({ section: "personal" | "security"; children })`: `<h1>Account settings</h1>`, a `<nav aria-label="Settings">` with three links ("Personal details" → `/account/settings`, "Security" → `/account/settings/security`, "Payment methods" → `/account/billing`, icons user/shield/credit-card), `aria-current="page"` on the current one, then the section card. At ≥768px: 240px nav column + card (frame 01's grid); below: the links in a row above the card.
  - `PersonalDetails({ details: PersonalDetails })`.

- [ ] **Step 1: Write the failing browser tests** (mock `./settings` with `vi.hoisted`, as `account.browser.test.tsx` mocks `./closure`; render with `renderWithRouter`):
  - Rows: "Maya Patel", "14 June 1991", the email, "Not added" for a null phone, "Flat 3, 28 Mare Street, London E8 3RL"; no button named "Change"; an "Edit details" button.
  - No customer: only Full name and Email address rows, no "Edit details".
  - Edit: Full name and Email inputs are read-only with the two hints; Mobile is editable.
  - Optimistic save: `updateMyPhoneFn` returns a promise you resolve later; type `07700900418`, click "Save changes" → the form closes and "07700 900418" shows before the promise resolves; it was called with `{ input: { phone: "07700900418" }, idempotencyKey: <uuid> }`.
  - Rollback: `updateMyPhoneFn` resolves `{ ok: false, error: { code: "VALIDATION", message: "x", fields: {} } }` → "Not added" is back, the form is open with `07700900418`, and "We couldn't save your mobile number. Try again." shows. A thrown error does the same.
  - Field error: resolves with `fields: { phone: "Enter a UK mobile number, like 07700 900418" }` → that text on the field.
  - Client check: typing `123` and saving shows the error without calling the server.
  - Nav: "Personal details" has `aria-current="page"`; "Payment methods" links to `/account/billing`.
- [ ] **Step 2:** `vp test run src/features/account/settings.browser.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Date of birth as "14 June 1991" (London long date); address joined with ", " and the postcode after the town with a space ("London E8 3RL"). One `crypto.randomUUID()` per Save. Optimistic: keep `shown` state; set it before awaiting, restore on failure. Styles in `settings.css` using the existing tokens and `account.css` patterns.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(account): settings layout and personal details with an optimistic mobile save`.

---

### Task 5: Security section and its dialogs

**Files:**
- Create: `src/features/account/SecuritySection.tsx`, `src/features/account/RecentActivity.tsx`
- Modify: `src/features/account/AccountSettings.tsx` (delete it once its three parts move: `WaysToLogIn` and `CloseAccount` go into `SecuritySection.tsx`; the old `TwoFactor` row is replaced), `src/features/auth/two-factor/SetupSteps.tsx` (export `ConfirmWithGoogle`'s Google call as `confirmWithGoogle(callbackURL: string): Promise<boolean>` so the dialog can reuse it; `ConfirmWithGoogle` calls it)
- Test: `src/features/account/settings.browser.test.tsx` (new `describe`)

**Interfaces:**
- Consumes: `AccountSummary` (`session.ts`), `RecentActivity`, `activityLabel`/`isWarningActivity`/`activityWhen`, `signOutEverywhereFn`, `authClient.twoFactor.disable`.
- Produces: `SecuritySection({ summary: AccountSummary; staff: boolean; activity: RecentActivity[]; now?: Date })`.

- [ ] **Step 1: Write the failing browser tests** (mock `../auth/auth-client`'s `authClient` with `twoFactor.disable` and `signIn.social`; mock `../auth/session`'s `signOutEverywhereFn`):
  - 2FA off: badge "Off", text "Add a code from an authenticator app when you log in.", a link "Turn on" to `/account/two-factor?redirect=%2Faccount%2Fsettings%2Fsecurity`.
  - 2FA on: badge "On", button "Turn off". Staff: no "Turn off", text "Staff accounts keep two-factor on."
  - Dialog 07 (password account): "Turn off two-factor" opens it with the warning and a Password field. Confirm with `disable` pending → dialog closed, badge "Off" at once; called with `{ password }`.
  - Wrong password: `disable` resolves `{ error: { code: "INVALID_PASSWORD" } }` → badge back to "On", dialog open again, field error "That password isn't right."
  - Other refusal: resolves `{ error: { message: "x" } }` → badge "On" and a danger toast.
  - Google-only (`providers: ["google"]`): no Password field; `disable` called with `{}`; on `{ error: { code: "SESSION_NOT_FRESH" } }` → badge "On", dialog shows "For your security, confirm with Google first." and a Google button calling `signIn.social` with `callbackURL: "/account/settings/security"`.
  - Dialog 08: "Sign out everywhere" opens it; confirm calls `signOutEverywhereFn` then navigates to `/login?signedOut=everywhere`.
  - Recent activity with a fixed `now`: rows "Signed in" / "Chrome on Windows · 2 hours ago", a failed row whose title has the warning class, "Unknown device" for a null device; empty list → "No activity yet."
  - Ways to log in and Close your account render as before (copy from today's `AccountSettings`).
- [ ] **Step 2:** `vp test run src/features/account/settings.browser.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement with `Dialog`, `Badge`, `Button`, `Input`, `Alert`, `useToast`. Better Auth's wrong-password code: check the real code in `two-factor.int.test.ts`'s new test (Task 3) and use that string. After a successful disable, `router.invalidate()` so the loader re-reads the summary.
- [ ] **Step 4:** Run again, plus `vp test run src/features/auth`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(account): security settings: two-factor on and off, sign out everywhere, recent activity`.

---

### Task 6: Routes and the login notice

**Files:**
- Modify: `src/routes/account_.settings.tsx` (Personal details; `?linked`/`?error` → redirect to `/account/settings/security` with the same search), `src/routes/_auth/login.tsx` (`signedOut: z.literal("everywhere").optional().catch(undefined)` → success toast "You've been signed out on every device." then clean the URL, as `reset=done` does)
- Create: `src/routes/account_.settings_.security.tsx` (the old toasts for `linked`/`error`; loader: `getAccountSummary`, `getMyRecentActivityFn`, and staff from `getTwoFactorSetup().staff`)
- Modify: `src/components/site/links.ts` only if it lists settings links (check; add nothing otherwise)

**Interfaces:**
- Consumes: Tasks 3–5.

- [ ] **Step 1:** Both routes: `headers: () => ({ "Cache-Control": "private, no-store" })`, `requireSignedIn`, titles "Account settings · Kerb" and "Security · Kerb", rendered inside `AccountShell` (no current tab) then `SettingsLayout`.
- [ ] **Step 2:** In `account_.settings.tsx`, `beforeLoad` throws `redirect({ to: "/account/settings/security", search })` when `linked` or `error` is set. Update `SetupSteps`/`AccountSettings` callers: `WaysToLogIn`'s `linkSocial` callback URLs become `/account/settings/security?linked=google` and `/account/settings/security?error=link`.
- [ ] **Step 3:** `vp check` and `vp test run src/features/account src/routes`. Expected: PASS. Run `vp dev`, open both pages signed in, check against frames 01, 02 and 06 at 1440 and 390px, then stop `vp dev`.
- [ ] **Step 4:** Commit `feat(account): settings routes for personal details and security; signed-out-everywhere notice`.

---

### Task 7: E2E and axe

**Files:**
- Create: `e2e/settings.spec.ts`
- Modify: `e2e/a11y.spec.ts` (both pages redirect a signed-out visitor to `/login`)

- [ ] **Step 1:** Write `settings.spec.ts`, following `account-close.spec.ts` (sign up, `confirmEmailInDatabase`, skip without `E2E_DATABASE_URL`). A new account has no customer row, so first complete a car quote save via `withCompleteJourney` (as `buy.spec.ts` does) to get one. Then:
  - `/account/settings` → "Edit details" → mobile `07700900418` → "Save changes" → "07700 900418" shows → reload, still there.
  - "Security" → "Turn on" → 4.6's steps with a code from `totpNow` (`src/test/totp.ts`), reading the key from the page as `auth.spec.ts`'s staff test does → back on Security, badge "On".
  - "Turn off" → password → badge "Off". Recent activity lists "Two-factor turned on" and "Two-factor turned off".
  - `/account/settings?linked=google` → the URL becomes `/account/settings/security` and the "Google connected" toast shows.
  - "Sign out everywhere" → confirm → `/login` with "You've been signed out on every device."
  - `expectNoSeriousAxeViolations` on both pages at 390, 768 and 1440px.
- [ ] **Step 2:** Run locally against `vp dev` with `E2E_DATABASE_URL` set to the local database (the memory rule: slice E2E runs locally). Expected: PASS.
- [ ] **Step 3:** Commit `test(account): settings E2E: mobile, two-factor on and off, sign out everywhere, axe`.

---

### Task 8: Done markers and the PR

**Files:** `plan/phases/06-account-claims/03-settings.md` (Status → done with the PR number; a "Notes from the build" section), `plan/phases/06-account-claims/phase.md` (6.3 → done), `plan/build-plan.md` (tick 6.3), `plan/figma.md` (list frames 06–08 under Account · Settings).

- [ ] **Step 1:** `vp check`, `vp test`, `vp build` (with `vp dev` stopped). Expected: all pass.
- [ ] **Step 2:** Update the four docs; commit `docs(account): 6.3 done`.
- [ ] **Step 3:** Push and open the PR into `staging` with `pull_request_template.md`, the spec link, the "Done when" list, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)` plus the Opsed trailer in the body. Title: `feat: account settings with your details and mobile number, two-factor on and off, sign out everywhere and your recent sign-in activity`.
