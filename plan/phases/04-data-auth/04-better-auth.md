# 4.4 Better Auth

**Status:** done (approved 4 Nov 2026; checked on staging 5 Nov 2026)
**Phase:** 04-data-auth

## Goal

Real accounts on the deployed site. People sign up with email + password or Google, get a verification email, sign in and out, and reset a forgotten password, using the screens designed in 4.3. Sign-ins, failures and resets are recorded in `security_events`.

This is the phase's payoff shot: sign up on the live site, click the verification email, sign in, then show the new row in the Neon console.

## Decisions (agreed 4 Nov 2026)

1. **Emails come from `Kerb <hello@kerb.opsedsolutions.com>`** (agreed 4 Nov 2026). Resend only sends to other people's addresses from a verified domain, and Kerb has no custom domain (engineering.md §2), so we use a subdomain of Damion's `opsedsolutions.com`.
   - **DNS** is at Namecheap: a DKIM TXT record plus two CNAMEs (`send.kerb`, `rsend.kerb`), Resend region `eu-west-1`. All three resolved on public DNS on 4 Nov.
   - **The root domain's own email** (its MX record, pointing at Amazon SES) is untouched.
   - **Receiving is off.** The site stays on `*.vercel.app`.
2. **Google sign-in and existing accounts** (agreed 4 Nov 2026; this replaces engineering.md §7's "a Google sign-in with the same verified email links to the existing account"):
   - **Only a Google email that Google itself has verified** (`email_verified`) is ever matched to an existing Kerb account. An unverified Google email never links.
   - **Existing account, email never verified:** linking is automatic, and the old password is deleted and its sessions signed out. Without this, someone who signed up with your email and their own password, and never confirmed it, would keep a password into your account. Google has just proved the address is yours. A `password_removed_on_link` event records it, and you can set a new password with "Forgotten your password?".
   - **Existing account, email already verified another way:** never merged automatically. The Google sign-in is refused with "You already have a Kerb account with this email. Log in with your password, then connect Google from your account." (new frame **08b**, a version of 08). Linking then has to be done on purpose: log in with your password, then press **Connect Google** on `/account` (Better Auth's `linkSocial`, from a signed-in session). That button moves to Settings in 6.3.
   - The account hook tells the two cases apart by whether the request comes from a signed-in session (an explicit link) or not (a sign-in). The integration tests below cover all three.
3. **Turnstile on sign-up and password reset only** (agreed), as designed in 4.3, not on sign-in. Sign-in is covered by the rate limit. **Real keys on Staging and Production; Cloudflare's always-pass test keys on Preview, local and e2e.** Turnstile checks the hostname, and preview hostnames change on every deploy.
4. **Too many tries** (agreed): 10 failed sign-ins from one IP in 15 minutes locks that IP out for the rest of the window, which matches 02b's "Wait 15 minutes". Better Auth's limiter counts per IP, not per account. Attacks spread across many IPs are left to the Vercel Firewall for now, and 8.9 re-checks this.
5. **`users.terms_accepted_at`** (agreed), a new column. Sign-up has a required "I agree to the terms of use" box, and the 4.2 rule is that every tick box is stored as a timestamp. It's added as a Better Auth `additionalField`, so the CLI regenerates the table. It ships in the same migration as `security_events` (`0003`).
6. **(agreed) A minimal `/account` page comes forward from 6.1**, as somewhere to land after sign-in. It has the account header, the verify banner (07/07b), the "Email confirmed" toast (07c), "Log out" and the 6.1 placeholder. 6.1 replaces its body.
7. **(agreed) The landing header keeps "Log in" for everyone.** The landing page is CDN-cached, so it can't know who's signed in (§9). `/login` sends a signed-in visitor straight to `/account`.
8. **(agreed) Previews get a narrow trusted-origin pattern.** engineering.md §7 says `*.vercel.app`, which would trust every Vercel app on the internet. I'll use `https://kerbonlineinsurance-*-damion-wilsons-projects.vercel.app` and update §7 to match.

## In scope

### Server (`src/server/auth/`)

- **`auth.ts` stops calling `getDb()` at import** (4.2 review): `getAuth()` builds the instance on first use. A small `cli.ts` exports the same config for Better Auth's `generate`.
- **Mounted** at `/api/auth/*` (`src/routes/api/auth/$.ts`, GET and POST to `getAuth().handler`), `Cache-Control: private, no-store`.
- **Base URL:** `BETTER_AUTH_URL` on Production and Staging. Previews use `https://${VERCEL_URL}`, so the variable stays unset there.
- **Email + password:** `minPasswordLength: 10`, `maxPasswordLength: 128`, `revokeSessionsOnPasswordReset: true`, `requireEmailVerification: false` (soft verification), and `rememberMe` from "Keep me logged in".
- **Breached passwords:** the `haveIBeenPwned` plugin on sign-up, reset and change password. Only the first 5 characters of the password's SHA-1 hash leave the server (k-anonymity). Message: "This password was in a data breach. Try a different one." (4.3).
- **Email verification:** sent on sign-up. The link lasts 24 hours and signs the user in automatically. It lands on `/email-confirmed`, which goes to `/account` with the 07c toast, or shows 07d if the link is bad or expired.
- **Password reset:** the link lasts 1 hour and lands on `/reset-password?token=…` (06), or 06b if it's expired. Resetting signs out every session.
- **Google:** `socialProviders.google` with `prompt: "select_account"`. Account linking follows decision 2: only Google-verified emails match; an unverified Kerb account is linked and its password removed; a verified one is refused (08b) until the owner connects Google from `/account` (`linkSocial`). The rules live in a `databaseHooks.account.create.before` hook. Google users arrive already verified. Errors return to `/login?error=google` (08).
- **OAuth proxy for previews:** the `oAuthProxy` plugin routes Google's callback through the staging URL, then back to the preview. If that proves awkward, previews hide the Google button, as §7 allows.
- **Sessions:** stored in the database. They last 7 days, refreshed once a day of use, with a 5-minute cookie cache. Cookies are `httpOnly`, `Secure`, `SameSite=Lax`.
- **Client IP:** taken from `x-vercel-forwarded-for` first, so the rate limit sees the real client and not Vercel's proxy.
- **Rate limits** (Better Auth's limiter, stored in Postgres):

  | Path | Limit |
  |---|---|
  | `/sign-in/email` | 10 per 15 min |
  | `/sign-up/email` | 5 per 15 min |
  | `/request-password-reset` | 3 per 15 min |
  | `/send-verification-email` | 3 per 15 min |
  | everything else | Better Auth's default |

  The 429 shows 02b on sign-in and a friendly "You're going a bit fast" elsewhere.
- **Turnstile:** the `captcha` plugin (`cloudflare-turnstile`) on `/sign-up/email` and `/request-password-reset`, checked on the server.
- **`trustedOrigins`:** the production URL; the staging URL; on Preview, the pattern from decision 8 plus `http://localhost:3000` locally.

### Emails (`src/server/email/`)

- `sendEmail()` wraps the Resend SDK (`resend`, new dependency). The verification and reset templates are plain HTML plus a text version, in Kerb's voice, written in code (no React Email).
- **Sent after the response** with `waitUntil`, never awaited in the request: an awaited send makes "this email has an account" visible from the response time. 4.11 moves both emails onto the jobs table.
- **A failed send** is logged (ids only) and the user sees a friendly message, never an error page (project-plan.md, Resend risk).
- Reset and resend always say "If that email has an account, we've sent a link." (4.3 copy rule).

### Security events (`0003` migration)

- **`security_events` table:**
  - `id` (`uuidv7()`)
  - `user_id` (nullable; `ON DELETE CASCADE`, since 4.7 deletes these rows with the account)
  - `type` (`CHECK`):
    - `sign_up`
    - `sign_in`
    - `sign_in_failed`
    - `rate_limited`
    - `sign_out`
    - `password_reset_requested`
    - `password_reset`
    - `email_verified`
    - `google_linked`
    - `google_link_refused`
    - `password_removed_on_link`

    4.6 adds the 2FA types.
  - `method` (`password` / `google`, nullable)
  - `ip_hash`: HMAC-SHA256 of the IP with `BETTER_AUTH_SECRET`, so it can't be reversed with a lookup table
  - `user_agent_summary`, e.g. "Chrome on Windows", for "Recent activity" in 6.3. Never the raw string.
  - `created_at`
  - indexes on `(user_id, created_at)` and `(type, created_at)`
- **Written by** a Better Auth `hooks.after` (sign-in, sign-up, sign-out, reset, verification, failures, 429s) and the account hook above. Hook writes are best-effort: a failed insert is logged and never fails the sign-in.
- **No email is ever stored.** A failed sign-in for an unknown address has `user_id` null.
- **Not hash-chained** (phase row): bot traffic can't flood the audit chain.
- **Data contract:** `copied: false` (nothing about sign-ins goes to the lakehouse); `record_delete` trigger as for every table.

### Pages (`src/routes/_auth/*`, `src/features/auth/*`)

- **`_auth` layout:** demo strip, top bar and brand panel (photo placeholder, decision 6 of 4.3) at web, tablet and mobile widths, as in Figma `178:2864`, `205:4404` and `207:5249`.
- **Routes:**

  | Route | Figma |
  |---|---|
  | `/login` | 01, 02, 02b, 08, 08b (new, decision 2) |
  | `/signup` | 03, 03b |
  | `/forgot-password` | 04, 05 |
  | `/reset-password` | 06, 06b |
  | `/email-confirmed` | 07d on error |
  | `/account` (decision 6) | 07, 07b, 07c, plus **Connect Google** (decision 2) |

- **Forms:** plain React state and zod schemas (`src/features/auth/schemas.ts`), shared with the server where it validates the same thing. Every page is `private, no-store`. Each form works in the order a keyboard user tabs through it, with errors linked by `aria-describedby` and focus moved to the first error.
- **New components from 4.3:**
  - `GoogleButton`
  - `PasswordHint` (10 characters, ticks as you type)
  - `Turnstile`: loads Cloudflare's script on demand, with nonce and CSP additions for `challenges.cloudflare.com` (`script-src`, `frame-src`)
  - `DemoStrip`
- **Guarding `/account`:** `beforeLoad` redirects to `/login?redirect=/account` without a session. Signed-in visitors to `/login` and `/signup` go to `/account`. 4.5 replaces this with `requireUser` and the formal route guards.
- **Log out** (on `/account`) ends the session and returns to `/`.

### Env and config

- **`env.ts` validates:**
  - `DATABASE_URL` (moved from `client.ts`)
  - `BETTER_AUTH_SECRET` (min 32 characters)
  - `BETTER_AUTH_URL` (optional)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `RESEND_API_KEY`, `EMAIL_FROM`
  - `TURNSTILE_SECRET_KEY`
- **The Turnstile site key is public:** `VITE_PUBLIC_TURNSTILE_SITE_KEY`, replacing `TURNSTILE_SITE_KEY` in `.env.example`.
- `.env.example` gets `EMAIL_FROM=` and the renamed key, all empty.

## Out of scope

- 2FA setup, challenge, trusted devices, the staff gate and the fresh-session check (4.6). Better Auth only asks for the 2FA code after email sign-in, not Google. 4.6 adds the code step for Google sign-ins in its own guard, and lets Google-only users confirm with Google (`allowPasswordless` plus a fresh session), as agreed on 4 Nov. Noted in the 4.6 row.
- Roles, `requireUser` / `requireRole`, scoped data and `audit()` (4.5).
- Delete account and the privacy page (4.7); Settings and "Recent activity" (6.3); the real account dashboard (6.1).
- Moving emails onto the jobs table (4.11). Per-account lockout across many IPs (8.9).

## What you set up (exact steps follow when the spec is approved)

1. **Resend:** the domain from decision 1 (three DNS records); two API keys, one for production and one for everything else (§2).
2. **Google Cloud:**
   - a project "Kerb" with the consent screen set to External and In production (basic scopes only: openid, email, profile, so no Google review needed)
   - two OAuth clients:
     - production: `https://kerbonlineinsurance.vercel.app/api/auth/callback/google`
     - staging: `https://kerbonlineinsurance-staging.vercel.app/api/auth/callback/google`, plus `http://localhost:3000/api/auth/callback/google`
3. **Cloudflare Turnstile:** one widget (Managed) for the production and staging hostnames.
4. **Vercel env vars** per environment:
   - a fresh `BETTER_AUTH_SECRET` for each (`openssl rand -base64 32`)
   - the Google, Resend and Turnstile values above
   - `EMAIL_FROM`, `BETTER_AUTH_URL`
   - the Turnstile test keys on Preview and Development

## Sources

- Better Auth 1.7.15 (installed): `emailAndPassword`, `emailVerification`, `socialProviders`, `account.accountLinking`, `databaseHooks`, `hooks`, `rateLimit`, `advanced.ipAddress`, and the `haveIBeenPwned`, `captcha` and `oAuthProxy` plugins. Checked in `node_modules`: the captcha plugin supports `cloudflare-turnstile`; the 2FA hook only matches `/sign-in/email`.
- engineering.md §7 (auth), §9 (Turnstile, CSP, logs), §10 (rate limits), §11 (jobs, for later); project-plan.md (Resend risk).
- Figma (4.3): `178:2864`, `205:4404`, `207:5249`; components in `177:2851`.
- `src/server/auth/auth.ts`, `src/server/db/schema/auth.ts`, `src/server/env.ts`, `src/server/security-headers.ts`, `src/components/site/links.ts`.

## Files

- **New:**
  - `src/server/auth/{cli,hooks,security-events}.ts`
  - `src/server/email/{send,templates}.ts`
  - `src/routes/api/auth/$.ts`
  - `src/routes/_auth.tsx` and `src/routes/_auth/{login,signup,forgot-password,reset-password,email-confirmed}.tsx`
  - `src/routes/account.tsx`
  - `src/features/auth/*` (forms, schemas, `authClient`, `GoogleButton`, `PasswordHint`, `Turnstile`, `DemoStrip`)
  - `src/server/db/schema/security-events.ts`
  - `drizzle/0003_*.sql`
  - tests (below)
- **Changed:**
  - `src/server/auth/auth.ts`, `src/server/db/schema/auth.ts` (CLI regenerate), `src/server/db/client.ts`, `src/server/env.ts`
  - `src/server/security-headers.ts` (Turnstile)
  - `src/server/db/data-contract.ts`
  - `.env.example` (empty values only), `package.json` (`resend`)
  - `plan/engineering.md` §7 (origins, decision 8), `plan/phases/04-data-auth/phase.md`, `plan/build-plan.md`

## Steps

- [x] You approve (4 Nov 2026)
- [x] You set up Resend, Google, Turnstile and the env vars (4 Nov 2026; two Turnstile values and `OAUTH_PROXY_SECRET` still to fix, see Results)
- [x] 08b and the Connect Google panel added in Figma, for your review
- [x] `env.ts`, lazy `getAuth()`, `0003`/`0004` migrations (`security_events`, `terms_accepted_at`), data contract
- [x] Schemas and the HIBP mock test, test first
- [x] Email + password, verification, reset, sessions, rate limits, Turnstile, security-event hooks; integration tests
- [x] `_auth` layout and pages, `/account`; component tests
- [x] Google, the linking rules (decision 2), Connect Google, OAuth proxy
- [x] CSP for Turnstile; e2e and axe specs
- [x] `vp check`, `vp test`, `vp build`; a local browser run against the Docker database
- [x] `vp run db:migrate` on Neon `dev` (Damion, 4 Nov) and a local run against it
- [x] Manual checks on the preview and staging

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | Auth schemas: email, name, password (9 characters refused, 10 accepted), terms required; the HIBP check with `fetch` mocked (breached → the 4.3 message, clean → passes, HIBP down → allowed and logged); the `ip_hash` is keyed and stable; `user_agent_summary` | yes |
| Component | Sign-up, log-in, forgot and reset forms: validation messages and focus; password hint ticks at 10; Google button; Turnstile token required before sign-up submits; 02b shown on a 429 | yes |
| Integration | Against the test database (4.2 review): sign up → sign in → turn on 2FA (the generated tables accept `timestamptz` and the `NOT NULL` booleans) | yes |
| Integration | Sign-in, failed sign-in and password reset each write one `security_events` row with a hashed IP and no email (phase table) | yes |
| Integration | Google sign-in, with Google's userinfo mocked: an unverified Google email never links; a Google-verified email on an **unverified** Kerb account links, removes its password and sessions and writes `password_removed_on_link`; on a **verified** Kerb account it's refused (`google_link_refused`, no account row added); signed in with a password, Connect Google links it (`google_linked`) and keeps the password | yes |
| Integration | Reset revokes every session; an 11th failed sign-in in 15 minutes returns 429 and writes `rate_limited` | yes |
| E2E | Sign up → log out → log in on the preview (Turnstile test keys, Resend's `delivered@resend.dev`); `/account` redirects to `/login` when signed out; axe on every auth page and `/account` | yes |
| Manual | On staging, then production after the release: Google sign-in works; the verification email arrives and confirms; reset works end to end; the new user row is in the Neon console | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` pass; `ci` green on the PR, including e2e and axe.
- [x] Full round trip on staging: sign up, verify by email, log out, log in, reset, Google sign-in.
- [x] `security_events` rows appear for each of those, with no emails or raw IPs.
- [x] Payoff shot recorded: the new row in the Neon console.
- [x] `.env.example` has empty values only.

## Commit message

`feat: accounts with email + password and Google sign-in, email verification, password reset, breached-password check, Turnstile, rate limits and security events`

## Results (4 Nov 2026, before the PR)

Changes from the spec:
- **Our own breached-password check instead of Better Auth's `haveIBeenPwned` plugin** (`src/server/auth/breached-password.ts`). The plugin fails closed: if Have I Been Pwned is down, sign-up and reset return a server error. Ours sends the same thing (the first 5 characters of the SHA-1 hash, padded), times out after 3 seconds and fails open with a log line, as the spec's test row asked.
- **Better Auth's linking default had to be turned off.** In 1.7.15, `requireLocalEmailVerified` (default on) refuses to link Google to an *unverified* Kerb account, the opposite of decision 2. It's off, and our `account.create` hooks apply decision 2 (`src/server/auth/linking.ts`). The hook tells a sign-in from a deliberate Connect Google by whether the request comes from a session signed in as that user.
- **The Google integration tests call the linking rules directly** against the test database (every case: new user, unverified, verified, explicit, another user's session), rather than faking Google's OAuth callback. The real callback is checked by hand on staging.
- **`OAUTH_PROXY_SECRET`, a new env var** on Staging and Preview (same value in both). The OAuth proxy seals Google's round trip through staging; with its own secret, Staging and Preview keep different `BETTER_AUTH_SECRET`s.
- **Auth env vars are validated on first use** (`getAuthEnv()`), not at import, so the CDN-cached landing page doesn't need them. Values are trimmed. `DATABASE_URL` stays in `getDb()`.
- **`security_events` has no `record_delete` trigger**, as it isn't copied to the lakehouse (the data contract test's rule). It has the append-only trigger (`0004`): no direct `UPDATE` or `DELETE`, only a cascade from its user.
- **`terms_accepted_at` is null for Google sign-ups**: they never tick the box.
- **Forms post and read their values from the form**, not React state. The local browser run showed that a click before the JavaScript loaded submitted natively as a GET, with the password in the URL; and that text typed before hydration was wiped. Now every form is `method="post"`, its submit button waits for hydration, and values are read with `FormData`.
- **From Damion's local run on Neon `dev` (4 Nov):** the "Email confirmed" and "Password changed" toasts showed twice (React's development double-run of effects) and again on refresh. `useOneTimeToast` shows each once and drops the `?confirmed` / `?reset` flag from the URL. TanStack Start warned that server functions had no CSRF protection: `createCsrfMiddleware` now refuses cross-site calls to them (`src/start.ts`).
- **Copy:** the wrong-password message is "That email and password don't match." on the field (frame 02 in Figma had the old "at least 8 characters"; fixed on web and mobile).
- **`/account`** has the demo strip, a dark header with the wordmark and Log out, the banner, the greeting (UK time, worked out on the server), Ways to log in and a placeholder. The full account header with its nav comes with 6.1.
- **If Resend is down** (asked 4 Nov): emails go after the response, so sign-up and reset still work. A failed send is logged and the person can press Resend or ask for another reset. Sends now give up after 10 seconds (`withTimeout`, `src/server/email/send.ts`), so a provider that hangs doesn't hold the function open. Automatic retries come with the jobs table in 4.11, alerts in 8.6.
- **Known trade-off:** sign-up says "There's already an account with this email" for a taken address, so sign-up can reveal that an email has an account (log in and reset never do). It's rate-limited and behind Turnstile. Hiding it would mean not signing people in straight away, which soft verification relies on.

What was built:
- Server: `src/server/auth/{auth,cli,breached-password,handler,linking,origins,request-info,security-events}.ts`, `src/server/email/{send,templates}.ts`, `src/routes/api/auth/$.ts`, `getAuthEnv()` in `env.ts`, Turnstile in the CSP.
- Database: `drizzle/0003_security_events.sql`, `drizzle/0004_security_events_append_only.sql`; `security_events` and `users.terms_accepted_at` in the schema and the data contract.
- Pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/email-confirmed` (`src/routes/_auth/*`), `/account`; components in `src/features/auth/*`; `mail` and `circle` icons; `resend` 6.37.0.
- Tests: 440 passing (`vp test`). New: unit `request-info`, `schemas`, `breached-password`, `origins` (39); integration `auth.int.test.ts` (16); component `auth.browser.test.tsx` (13); CSP tests updated. E2E: `e2e/auth.spec.ts` and the auth pages added to `e2e/a11y.spec.ts`; these run on the PR's preview.
- Local browser run (dev server on the Docker test database, Turnstile test keys): sign up → `/account` with the banner → resend → log out → wrong password → log in → `/login` while signed in goes to `/account`. `security_events` had a row for each step, with the user id and "Chrome on Windows" and no email. (`ip_hash` is empty locally: there's no forwarded-for header on localhost.)

Damion's local run on Neon `dev` (4 Nov, after `vp run db:migrate`): sign up, verification email from `hello@kerb.opsedsolutions.com` and its link (07c), wrong password, reset, a new Google account, the 08b refusal on a verified account, Connect Google, then log out and back in with Google. `security_events` had one row per step (`sign_up`, `email_verified`, `sign_in_failed`, `password_reset_requested`, `password_reset`, `google_link_refused`, `google_linked`, `sign_in`, `sign_out`), each with its user and no email. Then Google on an unverified account: `password_removed_on_link`, only Google left as a sign-in method, `email_verified` set true in the database. The page still showed the verify banner: the new session's 5-minute cookie cache held the user from before the link. `/account` now reads the session from the database (`disableCookieCache`); the redirect checks keep the cache.

Still to do before the PR is merged:
- **Vercel env (Damion):** in Development (and Preview, if the same values were used), `VITE_PUBLIC_TURNSTILE_SITE_KEY` holds the 35-character secret test key; it should be the site key `1x00000000000000000000AA`. `TURNSTILE_SECRET_KEY` there starts with a tab. Add `OAUTH_PROXY_SECRET` (one `openssl rand -base64 32` value) to Staging and Preview.
- The preview's e2e and axe run; Google on a preview (through the staging proxy); the round trip on staging.

