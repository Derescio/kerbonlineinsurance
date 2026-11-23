# 6.3 Account settings

**Status:** done (#113; spec approved by Damion, 22 Nov 2026)
**Phase:** 06-account-claims

## Goal

A signed-in customer manages their account from one Settings page built to the Account · Settings frames:
- **Personal details:** see their name, date of birth, email, mobile and home address, and add or change their mobile.
- **Security:** see how they log in, turn two-factor on or off, sign out everywhere, see their recent activity, and close their account.
- **Payment methods:** the existing Stripe portal at `/account/billing`.

**Why:** 4.6 built turning 2FA off and "sign out everywhere" on the server and left their buttons to 6.3, and 4.4 has been recording `security_events` for a "Recent activity" list since it shipped. Phase 7's Kerbie actions each need a matching page, and this is the account half of them.

## What exists already

- **`/account/settings`** ([AccountSettings.tsx](../../../src/features/account/AccountSettings.tsx)): Ways to log in (with Connect Google), a Two-factor row that links to `/account/two-factor` when off, and Close your account, moved there by 6.1. The route already sends `private, no-store`.
- **Two-factor (4.6):** `/account/two-factor` runs the setup steps (11a–11c), with a password or, for a Google-only account, "Confirm with Google" (a fresh Google sign-in within 10 minutes, `PASSWORDLESS_FRESH_MS`). Better Auth's `/two-factor/disable` asks a password user for their password and a passwordless one for a fresh session (`SESSION_NOT_FRESH` otherwise). It refuses staff (`TWO_FACTOR_REQUIRED`), and its `after` hook writes the `two_factor_disabled` event and the `two_factor.disabled` audit row.
- **Sign out everywhere (4.6):** `signOutEverywhereFn` ([session.ts](../../../src/features/auth/session.ts)) deletes every session, this one included, in one transaction with its `sessions.revoked_all` audit row, then records `signed_out_everywhere`. Nothing calls it yet.
- **`security_events`** ([security.ts](../../../src/server/db/schema/security.ts)): every sign-in, failure, reset, 2FA and session event, with `method`, a hashed IP and a `userAgentSummary` ("Chrome on Windows"). Indexed on `(user_id, created_at)`.
- **`customers.phone`** is nullable and nothing collects it: the quote journey never asks. So every customer's mobile is empty today. The data contract drops it from analytics.
- **`withIdempotency`** ([idempotency.ts](../../../src/server/db/idempotency.ts)) and `audit()` with `AUDIT_ACTIONS` ([actions.ts](../../../src/server/audit/actions.ts)).
- **Figma (Account · Settings `182:3249`):** 01 Personal details, 02 Personal details – editing, 03 Notifications, 04 Payment methods, 05 Communication preferences, and the frames added on 22 Nov 2026: 06 Security (`276:3822`), 07 Dialog – Turn off two-factor (`276:3885`), 08 Dialog – Sign out everywhere (`276:3900`). Frames 01 and 02 now have the three-item nav (Personal details · Security · Payment methods), and 02 locks the email with "To change your email, contact us."

## Decisions

1. **6.3 is split** (Damion, 22 Nov 2026). This slice is account settings. Changing the address, adding a driver and changing cover are **6.3b Policy changes**: each one re-prices the policy, shows the new price before Confirm, settles the difference in Stripe and writes a `policy_versions` snapshot (Damion chose re-pricing over holding the price to renewal). A home address isn't account-only: for a car policyholder it's where the car is kept, so it moves to 6.3b with the drivers.
2. **Three sections, as the updated frames show:** Personal details, Security and Payment methods. Notifications (03) and Communication preferences (05) aren't built until there's something behind them. 6.1's rule again: nothing leads nowhere.
   - `/account/settings` is Personal details and `/account/settings/security` is Security, each inside the account shell with the section nav on the left. "Payment methods" in the nav links to the existing `/account/billing`.
   - Below 768px the nav becomes a row of links above the card, like the account tabs. *(my call: there's no mobile frame)*
   - Old links keep working: Google's `?linked=google` and `?error=` come back to Security now (that's where Ways to log in lives), and `/account/settings` with those params redirects there. *(my call)*
3. **Personal details (frame 01):** Full name, Date of birth, Email address, Mobile number, Home address, then "Edit details".
   - Name, date of birth and address come from `customers`; email from the user.
   - **Mobile number** shows "Not added" when empty.
   - **Home address:** the "Change" button isn't shown until 6.3b.
   - **No customer row** (signed up but never saved a quote): only Full name (the user's name) and Email address, and no "Edit details", since there's no record to hold a mobile. *(my call)*
4. **Editing (frame 02):** Full name and Email locked, with "To change your legal name, call us. We'll need to update your policy too." and "To change your email, contact us." (Damion, 22 Nov 2026: email isn't editable). Mobile number is the only field. "Save changes" and "Cancel".
   - **Mobile rule:** a UK mobile, `07` and 9 more digits, or `+44 7` and 9 more; spaces allowed. Stored as entered with the spaces normalised to `07700 900418`. Empty clears it. Error: "Enter a UK mobile number, like 07700 900418". *(my call)*
   - **Optimistic** (phase perf note): on Save the form closes and the new number shows at once. If the server refuses, it goes back to the old number, the form reopens with the entered value, and a message says why ("We couldn't save your mobile number. Try again.", or the validation error).
   - **Server:** `updateMyPhone({ phone, idempotencyKey })` in `src/server/data/account.ts`, `signed_in` access, in the permission suite. One transaction: update `customers.phone`, write an audit row `customer.phone_changed` (new action, entity `customer`) with `changes: { phone: { set: true } }` or `{ set: false }`. The number itself never goes in the hash-chained log, so erasure (4.7) never has to touch it. *(my call)* Wrapped in `withIdempotency`; the client makes one key per Save, so a retried request changes and audits once.
5. **Security (frame 06):** one card, rows split by dividers.
   - **Ways to log in:** as today, including "Connect Google" for a password-only account.
   - **Two-factor:** the label, an "On" or "Off" badge, and the text from the frame. Off: "Turn on" goes to `/account/two-factor?redirect=/account/settings/security` (4.6's steps, unchanged). On: "Turn off" opens dialog 07. Staff see no "Turn off", just "Staff accounts keep two-factor on." *(my call: the server refuses them anyway)*
   - **Sign out everywhere:** "Signs you out on every device, including this one." and its button, which opens dialog 08.
   - **Recent activity** (decision 7).
   - **Close your account:** as today.
6. **The dialogs.**
   - **Turn off two-factor (07):** the warning "Anyone with your password will be able to log in without a code.", a Password field and "Turn off two-factor" in the danger style. A Google-only account has no password field: the button calls `disable` on the session's freshness, and on `SESSION_NOT_FRESH` the dialog says "For your security, confirm with Google first." with 4.6's Confirm with Google, which comes back here. *(my call)* Wrong password: the field's error "That password isn't right." **Optimistic:** on confirm the dialog closes and the badge shows "Off" at once; if the server refuses, it goes back to "On" with a danger toast naming why.
   - **Sign out everywhere (08):** "You'll be signed out on every device, including this one. You'll need to log in again." On confirm it calls `signOutEverywhereFn` and goes to `/login` with a one-time notice "You've been signed out on every device." Not optimistic: the session is gone either way.
7. **Recent activity:** the 10 newest `security_events` for the user, newest first, read by `getMyRecentActivity` in the data layer (`signed_in`, permission suite). It returns only type, method, `userAgentSummary` and time, never the IP hash.
   - **Labels:** sign_in "Signed in" (with Google: "Signed in with Google"), sign_in_failed "Failed sign-in attempt", sign_in_unverified "Sign-in before email was confirmed", rate_limited "Too many attempts", sign_out "Signed out", password_reset_requested "Password reset requested", password_reset "Password reset", email_verified "Email confirmed", google_linked "Google connected", google_link_refused "Google couldn't be connected", password_removed_on_link "Password removed when Google was connected", two_factor_enabled "Two-factor turned on", two_factor_disabled "Two-factor turned off", backup_codes_regenerated "New backup codes made", two_factor_passed "Two-factor code accepted", two_factor_failed "Wrong two-factor code", signed_out_everywhere "Signed out everywhere", sessions_revoked_on_password_change "Other devices signed out after a password change", sign_up "Account created".
   - **Warning style** (red title and icon, as the frame's failed row): sign_in_failed, rate_limited, two_factor_failed, google_link_refused.
   - **Meta line:** "{device} · {when}". Device is the `userAgentSummary`, or "Unknown device". When, in London time: under an hour "12 minutes ago", today "2 hours ago", yesterday "Yesterday, 21:14", otherwise "12 Nov 2026".
   - **Empty:** "No activity yet." (can't really happen, since signing in writes one).
8. **Idempotency:** the mobile save uses `withIdempotency` (decision 4). Turning 2FA off and signing out everywhere are idempotent by nature: a second `disable` finds it already off and a second sign-out has no session. The phase's "each change uses an idempotency key" is met by the one change that could double. *(my call)*
9. **The guard:** both pages use `requireSignedIn`, like today, and send `private, no-store`.

## In scope

- `/account/settings` (Personal details, view and edit) and `/account/settings/security`, with the section nav
- `updateMyPhone`, `getMyRecentActivity` and a personal-details read, all in the permission suite
- The `customer.phone_changed` audit action
- Dialogs 07 and 08
- Moving Ways to log in, Two-factor and Close your account from today's page into Security

## Out of scope

- Address, drivers, cover changes and `policy_versions`: 6.3b
- Changing the name or email
- Notifications and Communication preferences (frames 03, 05), and the Payment methods frame (04) beyond linking to the Stripe portal
- Regenerating backup codes from Settings (4.6 listed it for 6.3; not in the frames, so left for later)
- Listing or ending single sessions ("sign out of this device only")
- Mobile and tablet frames: the pages adapt the web frames, as 6.1 and 6.2 did

## Tests

| Layer | What |
|---|---|
| Unit | The mobile rule: `07700 900418`, `07700900418` and `+44 7700 900418` pass and normalise; landlines, short numbers and letters fail. The activity label for every `SECURITY_EVENT_TYPES` entry (adding a type without a label fails), and the "when" wording at each boundary |
| Integration | `updateMyPhone`: saves and audits `customer.phone_changed` without the number; the same idempotency key twice changes and audits once; a different payload with the same key is refused; a bad number is refused and nothing changes; a user with no customer row is refused. `getMyRecentActivity` returns only the user's 10 newest, with no IP hash. Both send `private, no-store` and join the permission suite |
| Integration | 2FA off from Settings: a password user with the right password turns it off (event + audit); the wrong password changes nothing; staff refused. Sign out everywhere ends every session and audits (4.6's tests, plus the Settings call path) |
| Component | Personal details: the rows; "Not added"; no "Change" on the address; no "Edit details" without a customer row. Editing: the optimistic save shows the new number at once, and a refused save rolls back with the message. Security: On/Off states, staff text, dialog 07 (password field, Google-only version), dialog 08; the optimistic 2FA off rolls back on refusal; the activity list with a warning row |
| E2E | Sign in → Settings → add a mobile → reload, it's there → Security → turn 2FA on via the 4.6 steps → turn it off → the activity shows both → Sign out everywhere lands on `/login`. axe on both pages at 390, 768 and 1440px |

## Done when

- Both pages match frames 01, 02 and 06 (and dialogs 07, 08) at desktop width and adapt at phone width.
- A customer can add, change or clear their mobile, turn 2FA on and off, sign out everywhere and see their recent activity.
- The tests above pass in `ci`.
- Preview manual check by Damion.

## Notes from the build

- **The mobile is kept out of the audit log and replies.** The audit row says only `{ phone: { set } }`, and `updateMyPhone` replies `{ set }` rather than the number, because the idempotency row stores the reply for 24 hours (checkpoint review). The page shows the number it sent, normalised by the same `mobileSchema`.
- **The mobile rule also takes dashes, dots and brackets**, and `+44 (0)7…` (checkpoint review). Under a minute, Recent activity says "Just now".
- **`SECURITY_EVENT_TYPES` moved to `schema/values.ts`** (re-exported from `security.ts`), so the labels in `settings-model.ts` can be typed against every event without features importing a schema file.
- **`Dialog` fix:** the browser's `close` event comes a task after `close()`. When the owner closed and reopened the dialog in between (Turn off two-factor reopening with "That password isn't right."), the late event shut it again. `Dialog` now ignores the close it asked for.
- **`ButtonProps` takes a `ref`** (React 19), so focus can return to "Edit details" after a save.
- **Turning two-factor off rotates the session** (Better Auth makes a new one and deletes the old). A reload before its answer arrives keeps the deleted token and lands signed out; the E2E waits for the answer. While the request runs the row shows no action, so nothing else is sent with the old session, and the row is keyed on the page's data so the badge follows it after setup (the E2E found it still said Off).
- **Sign out everywhere clears this browser's cookies too.** 4.6's server function deletes the sessions in our own transaction, so Better Auth's cached session cookie still said signed in, and the log-in page sent the browser on to `/account`. After the function, the page calls Better Auth's sign-out (which clears the cookies with no session left) and leaves with a full page load, as logging out does.
- **Recent activity's times use the loader's clock**, so the server render and hydration agree.
- **Ways to log in's Google return** now comes back to `/account/settings/security`. `/account/settings?linked=…` and `?error=…` redirect there, so older links still show their toast.
- **E2E locally** needs Turnstile's test keys (`VITE_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`, `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`) and `vp dev` on port 3000 (the `BETTER_AUTH_URL` origin). Local runs share one `127.0.0.1` sign-in bucket (10 per 15 minutes).

## Commit message

`feat: account settings with your details and mobile number, two-factor on and off, sign out everywhere and your recent sign-in activity`

## Sources

- The 6.3 row in [phase.md](phase.md) and its testing rows (optimistic rollback; idempotency key and `private, no-store`; 2FA on/off and "sign out everywhere")
- Figma Account · Settings `182:3249`: 01 `182:3254`, 02 `182:3358`, 06 `276:3822`, 07 `276:3885`, 08 `276:3900`
- 4.6 [06-two-factor.md](../04-data-auth/06-two-factor.md): the disable hooks, freshness for passwordless users, "sign out everywhere", and what it left to 6.3
- 6.1 [01-dashboard.md](01-dashboard.md) for the shell and "nothing leads nowhere"
