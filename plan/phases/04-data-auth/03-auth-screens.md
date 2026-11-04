# 4.3 Auth screens in Figma

**Status:** done (spec approved 3 Nov 2026; frames approved 4 Nov 2026)
**Phase:** 04-data-auth

## Goal

Every screen 4.4–4.6 builds is designed in Figma and approved by Damion before any auth code is written. That means fixing the five screens that already exist so they match the engineering rules, and adding the ones that don't exist yet: Google errors, the verify banner, setting a new password, 2FA setup and challenge, and the staff "2FA required" gate.

No app code in this slice. The output is Figma frames, a few local components, and the node IDs recorded in [figma.md](../../figma.md).

## What's there now (audited 3 Nov 2026)

Figma `Account · Web (auth)` `178:2864`, web only (1280 × 860), from the Claude Design kit `ui_kits/account/login.html`:

| Frame | Node | Matches the plan? |
|---|---|---|
| 01 · Log in | `178:2871` | Mostly. Has **Continue with Apple**, which we don't build |
| 02 · Log in, password error | `178:2996` | Yes |
| 03 · Create account | `178:3127` | No: Apple button; password rules say "8 or more characters / A number / An uppercase letter", but the rule is **min 10, breached-password check**; no demo notice; no Turnstile |
| 04 · Reset password | `178:3261` | No Turnstile |
| 05 · Reset link sent | `178:3357` | Yes |

Local components on `177:2851`: `Auth / Divider`, `Auth / Social buttons` (Google + Apple), `Auth / Brand panel` (photo placeholder "driver getting into a car").

## Decisions (agreed 3 Nov 2026)

1. **Two ways in: email + password, and Google. No Apple.** [engineering.md §7](../../engineering.md#7-authentication-and-authorization) has Google sign-in and nothing else, and Apple needs a paid developer account. `Auth / Social buttons` becomes one full-width **Continue with Google** button with Google's own "G" mark (Google's branding rules ask for the official logo, unchanged).
2. **Password rule copy follows the real rule:** one hint, "At least 10 characters", ticking green as you type. No number or uppercase rules: they aren't enforced, and current NIST guidance (SP 800-63B) advises against them. The breached-password check shows as a field error after submit: "This password was in a data breach. Try a different one."
3. **The help line uses a number from Ofcom's drama range**, `0306 999 0123`, instead of `0330 123 4567`, which could belong to someone. Kerb is fictional (README working rules). Opening hours stay.
4. **Web and mobile frames; tablet uses the web layout without the brand panel.** At 390 px the brand panel is hidden and the column runs full width with 16 px gutters. Every screen gets both frames, since the existing set is web only and Phase 5 will send most quote traffic through a phone.
5. **2FA setup is designed once, as an auth-layout page.** Staff are sent to it before any staff page (4.6). Customers reach the same steps from Settings (6.3), which reuses the frames as a dialog. Settings itself stays in 6.3.
6. **The brand panel keeps its placeholder photo for now.** Choosing the real photo is a 4.4 build task.

## In scope

All frames go on the `Account · Web` page `177:2850`, in the existing `Account · Web (auth)` section, numbered after `05`. They use the Phase 2 components (`Input`, `Button`, `Checkbox`, `Alert`, `Dialog`) and the Account local components.

### Fixes to existing screens (01–05)

- **01 Log in:** Google-only button; demo strip (below). Keep "Keep me logged in on this device" (Better Auth's `rememberMe`).
- **02 Password error:** keep. Add **02b Too many tries** (the rate limiter in 4.4): an `Alert` (warning) "Too many tries. Wait 15 minutes, or reset your password." with the form disabled.
- **03 Create account:** Google-only button; password hint per decision 2; the demo notice above the button: "Kerb is a demo. You can make an account and try everything, but no real cover is sold."; a Turnstile slot under the terms tick box. Add **03b Breached password** (field error per decision 2).
- **04 Reset password:** Turnstile slot under the email field.
- **05 Reset link sent:** keep.
- **Help line** on all screens per decision 3.
- **Demo strip:** the site's existing demo notice (`site-demo` in `SiteLayout`), placed at the top of the auth main column on every auth screen, so the notice never disappears.

### New screens

| # | Frame | What's on it |
|---|---|---|
| 06 | Set a new password | From the reset email: new password with the 10-character hint, "Save password". Success goes to log in with a toast "Password changed. Log in with your new password." |
| 06b | Reset link expired | "This link has expired" + "Send a new link" (back to 04) |
| 07 | Verify banner | `Acct / Header` with an `Alert` (info) under it: "Check your inbox to confirm maya.patel@example.com." + "Resend email". Dismissible for the session; it never blocks the page (soft verification) |
| 07b | Banner, email resent | Same banner, "Sent. It can take a minute to arrive." Resend disabled for 60 s |
| 07c | Email confirmed | Lands on the account with a success toast "Email confirmed." |
| 07d | Confirm link expired | Same pattern as 06b, "Send a new link" |
| 08 | Google sign-in failed | Back on log in with an `Alert` (error) "Google sign-in didn't work. Try again, or log in with your email." Covers a cancelled consent screen and an OAuth error |
| 09 | 2FA challenge | After password or Google: "Enter the 6-digit code from your authenticator app", the code input, "Trust this device for 30 days" (customers only), "Verify". Link "Use a backup code instead" |
| 09b | 2FA, wrong code | Code input in error: "That code didn't work. Codes change every 30 seconds, so use the newest one." |
| 10 | Backup code | One text field (`XXXXX-XXXXX`, mono), "Verify", "Use your authenticator app instead". Note: "Each backup code works once." |
| 11a | 2FA setup: confirm it's you | Password field (Better Auth asks for it before enabling 2FA) |
| 11b | 2FA setup: scan | QR code, the setup key in mono with a copy button, the code input, "Turn on two-factor". On mobile the QR shrinks and an "Open in authenticator app" button (`otpauth://` link) comes first |
| 11c | 2FA setup: backup codes | 10 codes in a mono grid, "Download" and "Copy", tick box "I've saved these somewhere safe" gates "Done" |
| 12 | Staff: 2FA required | Auth layout, `shield` icon, "Staff accounts need two-factor" + one line on why (claims and customer data) + "Set up two-factor" (→ 11a). No way past it but "Log out" |
| 13 | Confirm it's you (dialog) | `Dialog` over a staff page for the fresh-session check (4.6): "Enter a code from your authenticator app to continue." with the code input |

### Local components (on `177:2851`)

- **`Auth / Google button`**: replaces `Auth / Social buttons`. States default, hover, loading.
- **`Auth / Code input`**: six one-digit boxes in mono, auto-advancing, pasting a whole code fills all six. States empty, partly filled, filled, error, disabled. 4.6 builds it; the component tests in phase.md check it.
- **`Auth / Turnstile`**: a placeholder the size of Cloudflare's managed widget (300 × 65), so layouts leave room for it. Cloudflare draws the real one.
- **`Auth / Password hint`**: the one-rule hint, states unmet and met.
- **`Auth / Backup codes`**: the 2 × 5 grid with download and copy.

### Copy rules

Kerb's voice ([../readme.md](../../../../readme.md)): plain, short, second person, no "please" on every line. Errors say what happened and what to do next. Never say whether an email has an account ("If that email has an account, we've sent a link."), on log in, reset and resend.

## Out of scope

- Building any of it (4.4 email/password and Google, 4.6 2FA).
- Settings, "Recent activity", "sign out everywhere" and turning 2FA off (6.3; 4.6 builds the server side).
- Delete account and the privacy page (4.7).
- Email templates (verification and reset emails): plain branded HTML built with 4.4/4.11, not designed here.
- Apple and any other social sign-in.

## Sources

- Figma `ajpEaPwbWtwbsSmRheyDAU`: `Account · Web (auth)` `178:2864`, local components `177:2851`, `Acct / Header` `181:3310`; Phase 2 sets `Input` `7:96`, `Button` `5:306`, `Checkbox` `7:157`, `Alert` `11:105`, `Toast` `11:173`, `Dialog` `11:266`.
- [engineering.md §7](../../engineering.md#7-authentication-and-authorization) (auth rules), §9 (Turnstile).
- `../readme.md` (voice and visual rules).
- Better Auth `twoFactor` plugin (TOTP, backup codes, trusted devices) and `emailAndPassword` (`rememberMe`, reset flow).
- Google Identity branding guidelines (the sign-in button).
- NIST SP 800-63B §3.1.1 (password rules); Ofcom drama numbers (0306 999 0000–0999).

## Files

- Figma: the frames and components above.
- New: this file.
- Changed: [figma.md](../../figma.md) (new node IDs; remove "2FA screens and the Google sign-in flow" from "Not in Figma yet"), [phase.md](phase.md) (4.3 row), [build-plan.md](../../build-plan.md) (4.3 box).

## Steps

- [x] Damion approves this spec
- [x] Update the local components (Google button, code input, Turnstile, password hint, backup codes)
- [x] Fix 01–05; add 02b and 03b
- [x] New screens 06–13, web frames
- [x] Mobile frames for every screen (except 13, see Results)
- [x] Copy pass against the voice rules
- [x] Damion reviews in Figma; changes made
- [x] figma.md, phase.md, build-plan.md updated

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit / component / integration / E2E | none: no code in this slice. The component tests for these forms (validation messages, Google button, 6-digit code input) are written in 4.4–4.6 against these frames | — |
| Manual | Damion reviews every frame, web and mobile, in Figma and approves | yes |
| Manual | Every 4.4–4.6 state in [phase.md](phase.md)'s test table has a frame (sign up, sign in, reset, Google, verify, 2FA setup and challenge, backup code, staff gate, fresh-session check) | yes |
| Manual | Contrast: text and the code input's error state pass WCAG AA (Figma's contrast check or the tokens' known pairs) | yes |

## Done when

- [x] Every frame in the tables above exists, web and mobile, using the Phase 2 and Account components (no detached copies, except the 13 dialog, see Results).
- [x] No Apple button, no "8 characters" rule and no `0330` number left on the page.
- [x] Damion has approved the frames in Figma, including the changes from the spec below (4 Nov 2026).
- [x] figma.md lists every new node ID.

## Results (3 Nov 2026, approved 4 Nov 2026)

Where to look, on the `Account · Web` page `177:2850`, top to bottom:

| Section | Node | Frames |
|---|---|---|
| Local components · Account | `177:2851` | `Auth / Google button` `177:2863` (was Social buttons; every instance updated), `Auth / Password hint` `203:4397`, `Auth / Code input` `203:4463`, `Auth / Turnstile` `203:4464`, `Auth / Backup codes` `203:4469`, `Auth / Demo strip` `203:4515`, `Icon/google` `203:4373`, `Icon/copy` `203:4379` |
| Account · Web (auth) | `178:2864` | 01, 02, 02b `206:5230`, 03, 03b `206:5355`, 04, 05 |
| Account · Web (recovery and verify) | `205:4404` | 06 `205:4409`, 06b `205:4475`, 07 `206:4921`, 07b `206:4981`, 07c `206:5027`, 07d `205:4538`, 08 `205:4596` |
| Account · Web (two-factor) | `205:4701` | 09 `205:4706`, 09b `205:4776`, 10 `205:4848`, 11a `205:4910`, 11b `205:4973`, 11c `205:5059`, 12 `205:5151`, 13 `206:5066` |
| Account · Mobile (auth) | `207:5249` | 21 frames at 390 px, same numbering, in two rows |

The Settings, Policy and Admin sections moved down the page to make room. Their content is unchanged.

Changes from the spec (approved):

- **No second demo notice on sign-up.** The demo strip now sits at the top of every auth screen, so a second line above the button would say the same thing twice.
- **The verify banner can't be dismissed.** The Phase 2 `Alert` has no close button. It goes away once the email is confirmed. Say if you want a close button (that means a change to `Alert`).
- **Google button:** one component with no hover variant. Its loading state is the inner `Button`'s Loading property.
- **Create account frame is 1000 px tall** (others 860): with Turnstile and the demo strip it no longer fits in 860. The real page scrolls.
- **13 has no mobile frame.** The staff console is web only (Ops · Admin has no mobile frames either). Its dialog is a detached `Dialog`, because the component has no slot for the code input.
- **Copy changes:** breached password → "This password was in a data breach. Try a different one." (the longer line didn't fit the input's error row); checkbox hints shortened to fit 390 px ("We only use your details to run your account.", "Skip this step next time. Not on a shared computer."); 12's title is "Staff need two-factor" (the longer one broke "two-factor" over two lines).
- **11b on mobile:** "Open in authenticator app" (secondary button) comes first, and the QR code shrinks to 120 px.

Checked:

- No text containing "Apple", "8 or more" or "0330" remains in the auth sections or components.
- Contrast of the colour pairs used (WCAG AA needs 4.5:1 for text): danger on danger-bg 4.78, danger on page 4.97, `fg/3` on page 6.36, success on page 6.02, demo strip 13.58.
- Nothing clips at 390 px (checked for text wider than its instance).

**For 4.6:** Better Auth's `twoFactor.enable` asks for the user's password (11a), and a Google-only user doesn't have one. 4.6 needs to pick between the plugin's `allowPasswordless` option and asking them to sign in with Google again.

## Commit message

`docs: auth screens designed in Figma (Google sign-in, verify banner, reset, 2FA setup and challenge, staff 2FA gate)`
