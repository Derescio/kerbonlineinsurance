# 4.9 Seed data

**Status:** approved (Damion, 8 Nov 2026)
**Phase:** 04-data-auth

## Goal

One command fills Neon `dev` with synthetic data that makes Kerb look like an insurer that has been trading for a year. Staging and previews read `dev`, so the data shows up there straight away.

- **A cast.** A few named people you can sign in as on staging, on camera or from the E2E tests. Each one has a story that lights up the screens that exist today and the ones Phases 5 and 6 add, so the data is already waiting when each screen arrives.
- **A crowd.** About 2,000 synthetic customers with 12 months of backdated history across car, home, business and bundles. This is enough for Phase 9's funnel, conversion-by-district and claims-lifecycle models to mean something.
- **Every copied table in the data contract has rows** after a seed.
- **The 30-day closure check carried from 4.7** runs against two cast members.

The app is being built brick by brick. 4.9 seeds the data model as it stands. Screens that show this data come in later phases.

## Decisions

1. **`dev` only** (Damion, 8 Nov 2026). The seed writes to Neon `dev`, which staging and previews already read. It never touches `prod`, and the Vercel build never runs it.
2. **Both a cast and a crowd** (Damion, 8 Nov 2026): named accounts to sign in as, and enough history to analyse.
3. **Run by hand** (Damion, 8 Nov 2026). Damion runs `vp run db:seed` from his machine, and the data is on staging straight away.
4. **The cast below is right for now** (Damion, 8 Nov 2026).
5. **Cast email goes to Damion's inbox** (Damion, 8 Nov 2026), so the closure emails can be seen arriving.
6. **The closure window stays at 30 days. There is no env variable and no admin setting** (Damion agreed, 8 Nov 2026). Vercel Cron only calls Production (4.7), so a shorter window would change nothing on staging. `NOW=` on `account:run-closures` already simulates the passing days. For a real insurer the 30 days is a promise printed in the privacy notice, not an operational dial.
7. **Pricing is left to me** (Damion, 8 Nov 2026): a compromise that doesn't pull 5.4 forward. See call 9.

## Calls I've made (check these)

8. **Cast addresses use plus addressing.** Each address is `<local>+<role>@<domain>`, built from `SEED_INBOX` (`damionwilson@opsedsolutions.com` in `.env.local`, never in the repo). This gives `damionwilson+customer-a@opsedsolutions.com`, `+closure-held@` and so on: unique logins, one inbox. **Damion to check** that the mail host delivers `+` addresses (Google Workspace and Microsoft 365 both do). Crowd addresses use `@kerb-synthetic.invalid`, a reserved domain that can never receive mail, so nothing can email a synthetic person by accident.
9. **Seeded quotes are priced by a stand-in pricer that reads the real 4.8 v1 tables.**
   - **How it prices:** base rate × the factor rows that apply, the tier and add-on prices, min/max premium, then IPT. It writes the `quote_item_options`, `quote_item_addons` and `quote_item_factors` it used, and stamps the v1 `rating_version_id`.
   - **Where it lives:** in the seed's own folder. It isn't the app's pricing code, and nothing in `src/` imports it.
   - **Outcomes:** it applies the v1 referral and decline thresholds it can read directly, such as insurance group, driver age and `premium_above_max`. The cast's referral and decline are set up to trip those thresholds, so they come out of the tables rather than being written in by hand.
   - **5.4's row gets a note:** "replace the 4.9 stand-in pricer with `priceQuote()` and reseed `dev`". Until then, seeded prices only need to be close to what 5.4 will produce. Each one must reconcile, though, because the 4.2 `CHECK` constraints demand it.
10. **History is anchored to a fixed date, not to when the seed runs.** The 12 months run from 1 Nov 2025 to 31 Oct 2026, ending on 4.8's valuation date. A fixed random seed (a small PRNG such as mulberry32) makes every run produce exactly the same data. Ids are uuidv7 stamped with each row's backdated `created_at` (random bits from the same PRNG), so they stay time-ordered the way 4.2 intended. Cast policies are bought in the last few months, so they are still live in 2027.
11. **A rerun does nothing.** The seed checks for its own users first. If they are there, it prints "already seeded" with the row counts and exits 0. If not, it writes everything in **one transaction**, so a failure leaves `dev` as it was. Changing nothing on a rerun is simpler and safer than upserting every row, because `audit_log` is an append-only hash chain and a second pass would extend it.
12. **Reseeding is a Neon branch reset, not a delete script.** The steps are: "Reset from parent" on `dev`, then `vp run db:migrate`, `vp run db:reference`, `vp run db:seed`. Deleting synthetic users by script would fight the rules the app depends on: policies and claims are never deleted (4.7), the audit chain is append-only, and every delete leaves a tombstone. The reset also wipes any accounts made by hand on `dev`, and `auth:make-admin` brings an admin back. The spec documents this in `engineering.md §3`.
13. **It refuses anything but `dev`.** The seed prints the database host and refuses to run unless that host equals `SEED_DATABASE_HOST` from `.env.local` (the `dev` branch's host), using the existing `databaseHost()`. It also refuses when `VERCEL_TARGET_ENV` is set, so a build can never run it. It connects as the owner on `DATABASE_URL_UNPOOLED`, like `db:reference`.
14. **Auth rows are made the way Better Auth makes them.**
    - **Passwords:** hashed with Better Auth's own password hasher. All cast members share one password, `SEED_PASSWORD` from `.env.local`.
    - **Staff TOTP:** the handler and the admin get a TOTP secret from `SEED_TOTP_SECRET` (32 letters and digits, the form Better Auth generates; the seed prints the `otpauth://` link with its base32 encoding for the authenticator app), stored the way the `twoFactor` plugin stores it, so the E2E tests and Damion's authenticator app can produce codes. The plugin encrypts the secret with `BETTER_AUTH_SECRET`, so the seed must encrypt with **Staging's** value, or the codes work locally and fail on staging (see What you set up). Customers in the cast have 2FA off.
    - **Verification:** every seeded user has `email_verified = true` and `is_synthetic = true`.
15. **Audit rows go through the real chain, stamped when the seed runs** (revised while planning, 8 Nov 2026). The chain keeps `created_at` non-decreasing (`nextCreatedAt`), and `dev` already holds rows from November 2026, so backdated rows would run backwards. The audit log records when something was written, and the seed writes today. The seed uses only actions that already exist: `staff.added` for the handler and the admin, `claim.viewed` and `referral.viewed` for a sample of the crowd's work, and `account.closure_requested`, `account.closure_cancelled` and `account.closed` for the crowd's closures. Names such as `claim.status_changed` belong to the Phase 6 slices that perform those actions. Rows are chained with the same functions as `auth:make-admin`, and `verifyAuditChain()` must pass after a seed.
16. **Conflict of interest holds in the data.** No staff member decides a referral or handles a claim on a record of their own. That lets 4.5's queues show seeded work to the right people.
17. **The crowd's shape** (approximate, tuned while building):

    | What | About | Notes |
    |---|---|---|
    | Customers | 2,000 | sign-ups spread over the year, busier in January and September |
    | Quotes | 6,000 | about 70% never bought, as in real life; some abandoned as `draft`, some `expired` |
    | Underwriting outcomes | 85% quoted, 10% referred, 5% declined | most referrals decided by a staff member, a few still waiting |
    | Policies | 1,500 | car 60%, home 30%, business 10%; about 15% of customers hold a bundle; some `cancelled` or `lapsed` |
    | Payments | per policy | annual or monthly (the 10% credit charge from 4.8), a few `failed` then retried |
    | Claims | 300 | every status, including drafts; events, messages, third parties and settlements as each status implies |
    | Reviews | about 25% of policies | mostly `published`, a few `pending` and `rejected` |
    | Events | the funnel | `quote.started` → `quote.priced` → `quote.referred` / `policy.bought` → `claim.opened`, matching the rows above |
    | Notifications | as the rows imply | |
    | Account closures | a handful | a few cancelled with "keep my account", a few already closed and scrubbed |

    Postcodes are spread across all 121 areas, with a short hand-written weight list for the largest areas (London, Birmingham, Manchester and so on). Cars come from the 4.8 catalogue, weighted towards lower insurance groups so common cars dominate.
18. **Names and addresses are clearly fictional.** First and last names come from small built-in lists. Street addresses are made-up names. Districts are the area plus 1–9 (`LS6`), which exist for nearly every area. There's no district list in the repo, so a few won't be real. There is no faker dependency, so the output stays stable across library versions.
19. **Seeded references sit in the 9 range** (`KRB-Q-9xxxx`, `KRB-9xxxxx`, `KRB-C-9xxxx`), so Phase 5's generated references can never collide with them. 5.6's reference generator should draw from below that range, and the 5.4 note says so.

## The cast

All addresses are on `SEED_INBOX` (call 8). All passwords are `SEED_PASSWORD`.

| Who | Address suffix | Story |
|---|---|---|
| Customer A | `+customer-a` | Car and home bundle, a settled claim, a published review. The happy path for the Phase 6 dashboard. |
| Customer B | `+customer-b` | One car policy with an open claim (`assessing`). Customer A is refused B's records (4.5). |
| Business owner | `+business` | A business policy, plus a later quote referred for a high public liability limit, still waiting for a decision. |
| Closure, settled | `+closure-settled` | A car policy with one settled claim. The 4.7 check expects this account to close. |
| Closure, held | `+closure-held` | A home policy with an open claim (`received`). The 4.7 check expects this account to be held. |
| Claims handler | `+handler` | Staff, `claims_handler`, 2FA on with `SEED_TOTP_SECRET`. Assigned Customer B's claim and part of the crowd's claims. |
| Admin | `+admin` | Staff, `admin`, 2FA on. Has decided the crowd's older referrals. |

## The 30-day closure check (carried from 4.7)

1. Seed `dev`.
2. On staging, sign in as **Closure, settled**, request closure, and confirm with the password. Do the same for **Closure, held**. The "closure requested" emails arrive in Damion's inbox.
3. Run `NOW=<31 days on> vp run account:run-closures` locally (it targets `dev`).
4. In Neon: the settled account is closed (user scrubbed, email freed, policy and claims kept, `account.closed` in `audit_log`). The held account has `held_since` set and is still open. The matching emails arrive.

## In scope

- `vp run db:seed`: the script and its core (stand-in pricer, cast, crowd, guards), following the `scripts/x.ts` + `x-core.ts` pattern so the core can be tested.
- `.env.example`: `SEED_INBOX`, `SEED_PASSWORD`, `SEED_TOTP_SECRET`, `SEED_DATABASE_HOST` (names only).
- Docs: the reseed steps in `engineering.md §3`; the 5.4 row note (call 9); the 4.9 row, the testing row and `build-plan.md` marked done in the PR.

## Out of scope

- Any screen. The cast's policies and claims show up when Phases 5 and 6 build them.
- Seeding staging-only or production data, and running the seed in the Vercel build.
- An env variable or admin setting for the closure window (decision 6).
- E2E tests themselves. 4.9 provides the accounts that `engineering.md` says E2E will use.
- Uploaded files. `files` arrives in 4.10, and the seed gains claim photos then if 4.10 wants them.
- `jobs`, `idempotency_keys`, `rate_limits`, `sessions`, `verifications`: operational tables, not copied, left empty.

## What you set up

- In `.env.local`: `SEED_INBOX=damionwilson@opsedsolutions.com`, a `SEED_PASSWORD` of at least 10 characters, `SEED_TOTP_SECRET` (I'll generate one and tell you how to add it to your authenticator app), and `SEED_DATABASE_HOST` (the `dev` direct host).
- Check that a `+` address reaches your inbox (call 8).
- Check that `BETTER_AUTH_SECRET` in `.env.local` is the same as Staging's in Vercel (call 14). If it isn't, either make them match or give the seed Staging's value as `SEED_BETTER_AUTH_SECRET`.

## Tests

| Layer | What | Gate? |
|---|---|---|
| Integration | Seeding an empty test DB fills every copied table in the data contract; a second run changes no row counts and prints "already seeded" | yes |
| Integration | After a seed: every quote item reconciles (the 4.2 `CHECK` passes inside the transaction, and the test re-adds a sample); `verifyAuditChain()` passes; no staff member handles their own record; every synthetic row hangs off an `is_synthetic` user | yes |
| Integration | A cast customer signs in with `SEED_PASSWORD`; the handler signs in with a code from `SEED_TOTP_SECRET` | yes |
| Unit | The guard refuses a host other than `SEED_DATABASE_HOST` and refuses when `VERCEL_TARGET_ENV` is set; the stand-in pricer gives the 4.8 example people their expected band | yes |
| Unit | Same random seed, same output: two in-memory generations are identical | yes |
| Manual | The closure check above, on staging | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] `vp run db:seed` on `dev` finishes and prints its row counts, and a second run prints "already seeded".
- [ ] Customer A, the handler (with a code) and the admin can sign in on staging.
- [ ] The closure check passes: settled closes, held is held, and the emails arrive.

## Commit message

`feat: seed script for dev with a named cast and 12 months of synthetic customers, quotes, policies, claims and reviews priced from rating tables v1`

## Sources

**Plan:** `phase.md` 4.9 row and testing row; 4.2 decisions 10 and 16 (`is_synthetic`, defaults never forced); 4.5 conflict-of-interest rule; 4.5b audit chain; 4.7 carried check and the note that Vercel Cron only calls Production; 4.8 rating tables, thresholds and example people; `engineering.md` test-data line; Phase 9 rows 9.5 and the synthetic split.

**Damion, 8 Nov 2026:** `dev` only, shown through staging; both a cast and a crowd; run by hand; the cast as listed; cast email to his inbox; the closure window stays as it is; pricing left to me.
