# 4.4b Hard email verification

**Status:** done (approved 4 Nov 2026; checked on staging 5 Nov 2026)
**Phase:** 04-data-auth

## Goal

People who sign up with email and password must confirm their email before they can log in. Confirmation links last 6 hours instead of 24. This replaces 4.4's soft verification (a banner, not a blocker). Google sign-in is unchanged, because Google users arrive already verified.

## Decisions (agreed 4 Nov 2026)

1. **Hard verification** (Damion, 4 Nov 2026; this reverses project-plan.md's "verification is soft" and engineering.md §7's "a banner, not a blocker"). An unconfirmed email can't log in.
   - **Accepted risk:** if Resend's free allowance (200 a month) runs out or Resend is down, new email-and-password users can't get in until it's fixed. Google sign-in still works. project-plan.md's risk table is updated to match.
2. **The link lasts 6 hours** (Damion). Resends stay at 3 per 15 minutes.
3. **A separate slice after 4.4** (Damion): 4.4 merges as built, and 4.4b follows it on `staging`. Both reach `main` in the Phase 4 release, so production never has soft verification.
4. **Code first, Figma after** (Damion). The new states are built from existing parts (the `Alert`, the `AuthShell` layout, 07d), and the Figma frames are updated to match afterwards.

## In scope

### Server (`src/server/auth/auth.ts`)

- `emailAndPassword.requireEmailVerification: true` and `autoSignIn: false`. Sign-up creates the account and sends the link, but doesn't sign the person in.
- `emailVerification.expiresIn: 6 * 60 * 60`. `autoSignInAfterVerification` stays on, so clicking the link signs them in and lands on `/account` with the 07c toast.
- **No `sendOnSignIn`.** With it, every login attempt by an unconfirmed user sends another email, limited only by the sign-in rate limit (10 per 15 minutes), which would use up the Resend allowance. Instead, login shows a Resend button that goes through `/send-verification-email` (3 per 15 minutes).
- **Sign-up no longer reveals existing accounts.** With `requireEmailVerification` on, Better Auth 1.7.15 gives a duplicate sign-up the same success response as a new one (it even hashes the password, so the timing matches). This closes 4.4's known trade-off. `onExistingUserSignUp` emails the account's owner: "Someone tried to make a Kerb account with your email. If it was you, log in or reset your password."
- **A new `security_events` type, `sign_in_unverified`**, written when an unconfirmed account tries to log in. A correct password is required to get that far (Better Auth checks the password first).

### Screens (`src/features/auth/`, `src/routes/_auth/`)

- **Sign-up → "Check your inbox"** (new, 03c). After a successful sign-up, the form is replaced in place by: "Check your inbox", "We sent a link to {email}. It works for 6 hours.", a **Resend email** button (with the banner's existing countdown), and "Wrong email? Start again". The same screen shows for a duplicate email, so it doesn't reveal anything.
- **Login → "Confirm your email first"** (new, 02c). A 403 `EMAIL_NOT_VERIFIED` shows an info `Alert`: "Confirm your email first. Check your inbox for the link we sent, or get a new one." with **Resend email**. Today this error shows as "Something went wrong".
- **Expired link (07d)** copy changes to "Confirmation links work for 6 hours." Its button can't go to `/account` any more, because an unconfirmed user can't sign in. It becomes an email field plus **Send a new link**, which always says "If there's an unconfirmed account for that email, we've sent a new link" (the endpoint gives the same reply either way).
- **The `/account` verify banner (07/07b) is removed.** Every password user who can reach `/account` is now confirmed. `VerifyBanner`'s resend logic moves into a shared `ResendVerification` used by the three screens above.

### Emails (`src/server/email/templates.ts`)

- Verification email: "The link works for 6 hours."
- New "existing account" email for `onExistingUserSignUp`, plain HTML plus text, as in 4.4.

### Docs

- `engineering.md` §7, `project-plan.md` (soft-verification line and risk table), `build-plan.md` 4.4b line, `phase.md` row, `figma.md` (frames to update: 02c, 03c, 07d; 07/07b retired).

## Out of scope

- **Cleaning up accounts that are never confirmed.** They can't log in, and the Google rule (decision 2 in 4.4) still takes over an unverified account and removes its password. A cleanup job can come with 4.11 if it's wanted.
- **Changing email address** (6.3). It will need its own confirmation step.
- Gating features behind verification: with hard verification, every signed-in user is verified.

## Existing accounts

- **Production:** none (4.4 isn't released yet).
- **Staging and Neon `dev`:** test accounts that never confirmed can't log in after this. Confirm them through the 07d resend, or delete them in the Neon console.

## Steps

- [x] You approve this spec (4 Nov 2026)
- [x] Server config, `onExistingUserSignUp` and its email, `sign_in_unverified`; integration tests first
- [x] `ResendVerification`, the 03c and 02c states, the 07d form, banner removed; component tests
- [x] Copy (6 hours) in the email, 07d and 03c
- [x] e2e: the sign-up spec now stops at 03c, and logging in before confirming shows 02c
- [x] Docs
- [x] `vp check`, `vp test`, `vp build`
- [ ] `vp run db:migrate` on Neon `dev` (Damion), so previews accept the new event type
- [x] A browser run on the preview and on staging
- [x] Figma frames updated (02c `212:6156`, 03c `212:6295`, 07d `205:4538`) for your review

## Tests

| Layer | Test | Gate |
|---|---|---|
| Integration | Sign-up returns no session; logging in before confirming returns 403 `EMAIL_NOT_VERIFIED` and writes `sign_in_unverified`; after verifying, login works | yes |
| Integration | Sign-up with an existing email gives the same response as a new one, creates no user and calls `onExistingUserSignUp` | yes |
| Integration | A verification token older than 6 hours is refused (clock moved forward) | yes |
| Integration | The Google rules from 4.4 still pass unchanged | yes |
| Component | Sign-up success shows 03c with the email; login 403 shows 02c with Resend; the 07d form always shows the same reply; the Resend countdown | yes |
| E2E | Sign up → 03c; log in with that account → 02c. The verification link is a signed token sent only by email, so the preview run can't click it: the full confirm → log in path is covered by the integration test and the manual check. axe on 03c, 02c and 07d | yes |
| Manual | On staging: sign up, try to log in before confirming (02c), resend, confirm, log in; the duplicate sign-up email arrives | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` pass; `ci` green on the PR, including e2e and axe.
- [x] On staging, an unconfirmed account can't log in, and a confirmed one can.
- [x] The verification email says 6 hours, and an older link shows 07d.
- [x] Figma updated to match.

## Commit message

`feat: confirm your email before you can log in, with 6-hour links and no account enumeration on sign-up`

## Results (4 Nov 2026, before the PR)

Changes from the spec:
- **A migration, `0005_sign_in_unverified`.** `security_events.type` has a `CHECK` listing every type, so the new one needs it. Staging and production apply it in the build. **Neon `dev` needs `vp run db:migrate`** (Damion) before previews can write the event. Until then the insert fails and is logged; it never fails the log-in, because event writes are best-effort.
- **The 07d form says "Back to log in" under the button**, like 05.
- **The `USER_ALREADY_EXISTS` message on sign-up is gone.** Better Auth no longer sends that error, because a taken email gets the same answer as a new one.
- **`BackToLogIn` is exported** and `LinkExpired` now only serves 06b.

What was built:
- Server: `auth.ts` (`requireEmailVerification`, `autoSignIn: false`, `onExistingUserSignUp`, 6-hour `expiresIn`, `sign_in_unverified` in the after hook); `existingAccountEmail` in `templates.ts`; `sign_in_unverified` in `schema/security.ts`; `drizzle/0005_sign_in_unverified.sql`.
- Screens: `ResendVerification.tsx` (`ResendVerificationAlert` for 03c and 02c, `SendNewLinkForm` for 07d); `SignUpForm` (03c, "Wrong email? Start again"); `LoginForm` (02c); `email-confirmed.tsx` (07d); `AccountPage` without the banner.
- Tests: 456 passing (`vp test`). Integration: sign-up gives no session; a duplicate sign-up answers like a new one, creates no user and emails the owner; log-in before confirming returns 403 `EMAIL_NOT_VERIFIED`, writes `sign_in_unverified` and sends nothing; a wrong password on an unconfirmed account is still `sign_in_failed`; the link signs you in; the link works at 5 h 59 min and is refused at 6 h 1 min; a resend without a session answers the same for any address. The 4.4 tests now confirm before logging in. Component: 03c, "Start again", 02c with Resend and its countdown, and 07d (empty email, same reply, 429). E2E: sign-up → 03c → log in → 02c → `/account` still guarded; 07d; axe on 03c, 02c and 07d.

After the PR (5 Nov 2026):
- Merged as #52. Staging built it and applied `0005`; Damion's checks on staging passed (sign-up → 03c, 02c and Resend, the 6-hour email, confirm → log in, duplicate sign-up, 07d, Google).
- Figma, web only: 02c `212:6156` (a copy of 02b with the info `Alert` and Resend) and 03c `212:6295` (a copy of 05 with the sign-up heading, the info `Alert` and a ghost "Wrong email? Start again") in `Account · Web (auth)` `178:2864`; 07d `205:4538` updated in place (6 hours, email field, ghost "Back to log in"). 07 and 07b are kept at half opacity, labelled "retired in 4.4b". The mobile frames (`207:5249`) aren't updated yet.

