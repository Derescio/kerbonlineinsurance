# Phase 4: Data and auth

**Tag:** `s4-data-auth` · **Status:** in-progress

## Goal

Real database and real accounts: Neon + Drizzle schema; Better Auth with email + password and Google; roles, permissions and 2FA; privacy page and delete account; reference and seed data; file uploads.

## Payoff shot

Sign up on the live site, click the verification email, sign in, then show the new row in the Neon console.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 4.1 | [Neon + Drizzle](01-neon-drizzle.md): project in London (`aws-eu-west-2`), branches `prod` and `dev`; pooled connection + node-postgres (one driver, tests included); `db:generate` / `db:migrate` scripts; migrate + reference-data step in the Vercel build for staging and production only; CI drift check. Never `drizzle-kit push` on shared DBs. See [engineering.md §3](../../engineering.md#3-database-migrations-drizzle). **Testing** ([engineering.md §4](../../engineering.md#testing)): `unit` / `integration` Vitest projects; test DB (Docker Postgres locally, Postgres service container in `ci.yml`, migrations applied fresh each run); same `pg` driver and `getDb()` in tests; one sample `*.int.test.ts` that proves a failing integration test fails `ci` | done |
| 4.2 | [Schema + first migration](02-schema.md): shared core (customers, quotes + quote_items, policies with `product`, bundles, claims, claim_events) + one detail table per product (car: vehicles/drivers; home: properties; business: businesses) + auth tables + every wireframe field (all cover tiers offered, add-ons, payments, draft claims, third parties, claim messages, settlements, notifications; references in the Figma formats) + `staff_members` (the only place a role lives; staff deactivated, never deleted; claim handlers and referral deciders must be staff) + data-side tables (`deleted_rows` tombstones, `quote_item_factors`, `events`) and a data contract kept in sync by a unit test (for Phase 9) + `audit_log` (append-only, hash-chain columns, no FKs so it outlives deleted accounts) + underwriting (`quote_items.outcome` quoted/referred/declined, append-only `underwriting_decisions`, `rating_versions`; quote totals reconcile by `CHECK`). **Perf:** indexes on foreign keys and hot filters (`user_id`, `status`, `created_at`). **Integrity** ([engineering.md §8](../../engineering.md#8-data-integrity-and-idempotency)): foreign keys with deliberate `ON DELETE`, `NOT NULL` by default, `CHECK` (rating 1–5, amounts ≥ 0, statuses), unique (one review per policy, one policy per quote); money in pence; `timestamptz`; `version` on claims and policies; `idempotency_keys`, `rate_limits` and `jobs` tables | done |
| 4.3 | [Auth screens designed in Figma](03-auth-screens.md) (Damion approves): sign up / sign in with a Google button, reset, verify banner, 2FA setup and challenge, staff "2FA required" | done |
| 4.4 | [Better Auth](04-better-auth.md) ([engineering.md §7](../../engineering.md#7-authentication-and-authorization)): sign up (with a demo notice: no real cover is sold), email + password (min 10 chars, Have I Been Pwned check), soft email verification (banner, not a blocker), **Google sign-in** with account linking and the OAuth proxy for previews, DB sessions (7 days, sliding, cookie cache), DB-backed rate limits, `trustedOrigins` per environment, sign out. **Security events:** Better Auth hooks write sign-ins, failed sign-ins, lockouts, password resets and Google account links to a `security_events` table (own migration; not hash-chained, so bot traffic can't flood the audit chain; IP hashed), shown later as "Recent activity" in Settings (6.3). Neon connection string supplied by Damion. **Turnstile** on sign-up and password reset ([engineering.md §9](../../engineering.md#9-security)). **From the 4.2 review:** an integration test that signs up, signs in and turns on 2FA against the test database (4.2 changed the generated tables: `timestamptz`, `NOT NULL` booleans); `auth.ts` stops calling `getDb()` at import. | done |
| 4.4b | [Hard email verification](04b-hard-verification.md): confirm your email before you can log in (replaces 4.4's soft verification; Damion, 4 Nov 2026); links last 6 hours; "Check your inbox" after sign-up, "Confirm your email first" on login, 07d resends without a session; duplicate sign-ups no longer reveal an account | done |
| 4.5 | [Authorization layer](05-authorization.md) ([engineering.md §7](../../engineering.md#7-authentication-and-authorization)): access by **permission**, not role name (`ROLE_PERMISSIONS` in `src/server/auth/permissions.ts`); several roles per staff member (`staff_roles` replaces `staff_members.role`); `Actor`, `requireUser` / `requirePermission` server middleware (refuses deactivated staff); **conflict-of-interest rule**, reads included: staff queues leave out the staff member's own records; scoped customer and staff reads in `src/server/data/*` (policies, claims, referrals; someone else's record is `NOT_FOUND`); lint rule keeping database access in the data layer; route guards (UX only) with a `_staff` layout; `vp run auth:make-admin <email> --name "<name>"`; impersonation off; permission suite as integration tests (every function × nine actors (guest plus eight signed-in), expectations taken from the map) | done |
| 4.5b | [Audit integrity and database security](05b-audit-integrity.md) ([engineering.md §7](../../engineering.md#7-authentication-and-authorization)): `audit()` writing `audit_log` inside the caller's transaction, chained with a keyed **HMAC-SHA256** under `pg_advisory_xact_lock`; versioned keys (`key_version`, `AUDIT_HMAC_KEYS`, rotation without rewriting rows); `verifyAuditChain()` naming the first bad row; fails closed; `claim.viewed` and `referral.viewed` on the staff reads and `staff.added` from `auth:make-admin`; the app connects as the non-owner role `kerb_app` (`0010`; `SELECT` and `INSERT` only on `audit_log`, no `TRUNCATE`), with the owner on `DATABASE_URL_UNPOOLED` for migrations; `vp run db:check-app-role`; the integration suite runs as `kerb_app`. Split from 4.5 on 5 Nov 2026 | done |
| 4.5c | **Safe write tools** (split from 4.5b, 5 Nov 2026): `withTx` (every write rolls back on a thrown error), `withIdempotency` (the first result returns on a repeat; the same key with another payload is refused), the shared `limit()` sliding-window rate limiter, and the validation-error contract; each with tests | todo |
| 4.6 | **2FA**: TOTP + backup codes (Better Auth `twoFactor`); optional for customers, required for staff before any staff page; fresh-session check on staff actions; "sign out everywhere"; sessions revoked on password change. 2FA set up / removed, backup codes regenerated and challenges go to `security_events`; turning 2FA off and "sign out everywhere" also write `audit_log`. **Google sign-ins (agreed 4 Nov 2026):** Better Auth only asks for the code after email sign-in, so our own guard sends a Google session that hasn't passed the code check to the challenge (09); Google-only users turn 2FA on by confirming with Google (a fresh session plus `allowPasswordless`), shown as a Google version of 11a | todo |
| 4.7 | Privacy page + delete account (writes an `audit_log` row; the user's existing audit rows stay, holding only the user id, and `security_events` rows are deleted). The privacy notice names PostHog and links to the consent banner from 3.5 | todo |
| 4.8 | Reference data: curated vehicle catalogue (~40 popular UK models; make → model → year → variant with insurance group 1–50 and value), rating tables v1 for car/home/business, including tier multipliers (Essential / Comprehensive / Plus), compulsory excess per tier, add-on prices (UK breakdown, motor legal) and occupation bands (each version a row in `rating_versions` from 4.2, set `active`; factor tables point at it), postcode-area risk bands. `vehicles` gains a nullable `catalogue_variant_id` foreign key to the catalogue, so it joins as a dimension in Databricks; every new table gets a data-contract entry and a `record_delete` trigger. **Perf:** catalogue and rating tables memoised in module scope, keyed by `rating_version`; upsert script runs in the deploy build | todo |
| 4.9 | Seed script (synthetic, idempotent; backdated `created_at`/`updated_at`/`occurred_at` spread over 12 months so the data has history; fills every table in the data contract, including `events`, `quote_item_factors`, `underwriting_decisions` (some referrals and declines), `claim_events` and reviews; car, home, business policies and bundles); adds a demo claims handler and claims in several states | todo |
| 4.10 | Upload foundation (see [engineering.md §6](../../engineering.md#6-file-storage-cloudflare-r2)): Damion creates R2 buckets `kerb-dev`/`kerb-prod`, CORS and scoped tokens in Cloudflare; `files` table + migration; `createUpload` / `confirmUpload` / `getFileUrl`; client helper (resize to WebP, EXIF strip, thumbnail, progress); daily cleanup cron; delete-account hook; Vitest tests for limits, ownership and the magic-byte check; ownership checks reuse the 4.5 data layer; staff can read claim files; `createUpload` goes through the shared rate limiter | todo |
| 4.11 | **Background jobs** ([engineering.md §11](../../engineering.md#11-background-processing)): `jobs` table used as an outbox (enqueued in the same transaction), run straight away with `waitUntil`, per-minute Vercel Cron retries with exponential backoff, `dead` after 5 attempts and shown in the admin area; idempotent handlers; verification/reset emails and the upload cleanup move onto it; **anchor the audit chain's latest hash in R2 daily** (4.5 decision 4); integration test: a failing job retries with backoff and lands in `dead` after 5 attempts | todo |

## Extras (carried from Phase 3)

Shipped with the first Phase 4 commit to staging: a landing hero refresh. H1 is now "Insurance made simpler." with "simpler." in marker yellow; the postcode card opens with "Let's get you covered."; the 3.3 excess callout is removed (it made the hero too busy); the hero photo stretches to the copy column's height so the two sides balance, with a light border and a deeper drop shadow.

## Recording notes

- 11 slices: record in two parts. Part 1: 4.1–4.6 (data, auth, authorization, 2FA). Part 2: 4.7–4.11 (privacy, data, uploads, jobs).

- Next.js comparison: NextAuth/Auth.js vs Better Auth; middleware vs TanStack route `beforeLoad` guards.
- Point at the schema diagram: this is the data the data video will pick up.
- Secrets go into Vercel env vars on camera (blur the values).

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). This phase adds the `integration` Vitest project and the Postgres service in `ci.yml` (4.1). This table collects the tests named in the slice rows above and fills the gaps.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Integration | Migrations apply cleanly to an empty DB; a sample failing `*.int.test.ts` fails `ci`; drift check catches a schema change with no migration | 4.1 | yes |
| Integration | DB constraints refuse bad rows: rating 6, a negative amount, a second policy for one quote, an unknown status, a missing `NOT NULL` field; quote totals that don't add up, an option priced at 0, a second `active` rating version, an `UPDATE` on `claim_events` or `underwriting_decisions` | 4.2 | yes |
| Unit | Auth input schemas; password rule (min 10 chars); breached-password check with the HIBP call mocked | 4.4 | yes |
| Component | Sign up, sign in, reset and 2FA forms: validation messages, Google button, 6-digit code input | 4.3–4.6 | yes |
| Integration | Permission suite: every data function × guest, customer A, customer B, handler, admin, a deactivated handler, an admin who is also a customer and a staff member with no roles, including cross-user ids ([§7](../../engineering.md#tests)); expectations come from the role map; a deactivated handler is refused; an admin is refused their own claim and their own referral | 4.5 | yes |
| Unit + Integration | The role map snapshot; `requirePermission` takes the union of roles; the `staff_roles` migration copies existing roles; `auth:make-admin` | 4.5 | yes |
| Integration | `withTx` rolls back every write on a thrown error; `withIdempotency` returns the first result on a repeat and refuses the same key with a different payload; `limit()` sliding window allows N then returns 429 | 4.5c | yes |
| Integration | `audit()` writes inside the caller's transaction (rolled back together); concurrent writes keep one unbroken chain; `verifyAuditChain()` passes on a clean log and names the first bad row after a row is altered with the trigger disabled | 4.5b | yes |
| Integration | Sign-in, failed sign-in and password reset each write one `security_events` row with a hashed IP and no email | 4.4 | yes |
| Integration | Staff functions refused without 2FA set up or with a stale session; password change revokes other sessions; "sign out everywhere" ends them all | 4.6 | yes |
| Integration | Delete account removes the user's rows and R2 objects (S3 client mocked) and writes an `audit_log` row; the user's earlier audit rows remain and the chain still verifies | 4.7 | yes |
| Integration | Reference-data upsert is idempotent and keyed by `rating_version`; the module-scope cache returns the same tables for the same version | 4.8 | yes |
| Integration | Seed script run twice gives the same row counts; after seeding, every copied table in the data contract has rows | 4.9 | yes |
| Integration | `createUpload` enforces kind, count, MIME and size limits and parent ownership; `confirmUpload` rejects a renamed `.exe` by magic bytes; `getFileUrl` refuses another user's file; staff can read claim files | 4.10 | yes |
| Component | Upload client in real Chromium: a large JPEG comes out as WebP ≤ 2048 px with no EXIF; thumbnail is 400 px | 4.10 | yes |
| Unit + Integration | Backoff calculation (unit); a failing job retries with backoff and lands in `dead` after 5 attempts; a rolled-back transaction leaves no job; a handler run twice has one effect | 4.11 | yes |
| E2E | Sign up → sign out → sign in; a seeded staff account is sent to 2FA setup before any staff page; axe on the auth pages. Turnstile uses Cloudflare's test keys | 4.4–4.6 | yes |
| Manual | Google sign-in on staging and production; the verification email arrives; the 12 MB phone photo check with `exiftool` | 4.4, 4.10 | yes |

## Exit criteria

- `integration` project passes in `ci`; auth E2E and axe pass on the preview.
- Full auth round-trip works on the deployed URL.
- Permission test suite passes (every data function × 9 actors, guest included); customer B is refused customer A's policy, claim and file ids.
- A new staff account can't open staff pages until 2FA is set up; Google sign-in works on staging and production; each staff action writes an `audit_log` row.
- Seed script reruns without duplicates.
- Double-submitting any important write returns the first result (idempotency tests); a failed job retries and then lands in `dead`.
- A 12 MB phone photo uploads straight to R2 (network tab: `PUT` to R2, not Vercel), lands as WebP of at most 2048 px with no GPS EXIF (`exiftool`); a renamed `.exe` is rejected; user B can't get user A's file URL.
- Deployed and tagged.
