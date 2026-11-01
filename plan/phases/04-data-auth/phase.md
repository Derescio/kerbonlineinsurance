# Phase 4: Data and auth

**Tag:** `s4-data-auth` · **Status:** todo

## Goal

Real database and real accounts: Neon + Drizzle schema; Better Auth with email + password and Google; roles, permissions and 2FA; privacy page and delete account; reference and seed data; file uploads.

## Payoff shot

Sign up on the live site, click the verification email, sign in, then show the new row in the Neon console.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 4.1 | Neon + Drizzle: project in London (`aws-eu-west-2`), branches `prod` and `dev`; pooled connection + serverless driver; `db:generate` / `db:migrate` scripts; migrate + reference-data step in the Vercel build for staging and production only; CI drift check. Never `drizzle-kit push` on shared DBs. See [engineering.md §3](../../engineering.md#3-database-migrations-drizzle). **Testing** ([engineering.md §4](../../engineering.md#testing)): `unit` / `integration` Vitest projects; test DB (Docker Postgres locally, Postgres service container in `ci.yml`, migrations applied fresh each run); node-postgres driver for tests, chosen by env; one sample `*.int.test.ts` that proves a failing integration test fails `ci` | todo |
| 4.2 | Schema + first migration: shared core (customers, quotes + quote_items, policies with `product`, bundles, claims, claim_events) + one detail table per product (car: vehicles/drivers; home: properties; business: businesses) + auth tables. **Perf:** indexes on foreign keys and hot filters (`user_id`, `status`, `created_at`). **Integrity** ([engineering.md §8](../../engineering.md#8-data-integrity-and-idempotency)): foreign keys with deliberate `ON DELETE`, `NOT NULL` by default, `CHECK` (rating 1–5, amounts ≥ 0, statuses), unique (one review per policy, one policy per quote); money in pence; `timestamptz`; `version` on claims and policies; `idempotency_keys`, `rate_limits` and `jobs` tables | todo |
| 4.3 | Auth screens designed in Figma (Damion approves): sign up / sign in with a Google button, reset, verify banner, 2FA setup and challenge, staff "2FA required" | todo |
| 4.4 | Better Auth ([engineering.md §7](../../engineering.md#7-authentication-and-authorization)): sign up (with a demo notice: no real cover is sold), email + password (min 10 chars, Have I Been Pwned check), soft email verification (banner, not a blocker), **Google sign-in** with account linking and the OAuth proxy for previews, DB sessions (7 days, sliding, cookie cache), DB-backed rate limits, `trustedOrigins` per environment, sign out. Neon connection string supplied by Damion. **Turnstile** on sign-up and password reset ([engineering.md §9](../../engineering.md#9-security)). | todo |
| 4.5 | **Authorization layer** ([engineering.md §7](../../engineering.md#7-authentication-and-authorization)): roles `customer` / `claims_handler` / `admin`; `requireUser` / `requireRole` server middleware; scoped data access in `src/server/data/*` (owner id from the session only); route guards (UX only); `audit_log`; `vp run auth:make-admin <email>`; impersonation off; permission tests as integration tests (`*.int.test.ts`, every protected function × guest, customer A, customer B, handler, admin) incl. cross-user access; also `withTx` (transactions), `withIdempotency` (repeat returns the first result) and the shared `limit()` rate limiter, each with tests | todo |
| 4.6 | **2FA**: TOTP + backup codes (Better Auth `twoFactor`); optional for customers, required for staff before any staff page; fresh-session check on staff actions; "sign out everywhere"; sessions revoked on password change | todo |
| 4.7 | Privacy page + delete account (writes an `audit_log` row). The privacy notice names PostHog and links to the consent banner from 3.5 | todo |
| 4.8 | Reference data: curated vehicle catalogue (~40 popular UK models; make → model → year → variant with insurance group 1–50 and value), rating tables v1 for car/home/business, postcode-area risk bands. **Perf:** catalogue and rating tables memoised in module scope, keyed by `rating_version`; upsert script runs in the deploy build | todo |
| 4.9 | Seed script (synthetic, idempotent; car, home, business policies and bundles); adds a demo claims handler and claims in several states | todo |
| 4.10 | Upload foundation (see [engineering.md §6](../../engineering.md#6-file-storage-cloudflare-r2)): Damion creates R2 buckets `kerb-dev`/`kerb-prod`, CORS and scoped tokens in Cloudflare; `files` table + migration; `createUpload` / `confirmUpload` / `getFileUrl`; client helper (resize to WebP, EXIF strip, thumbnail, progress); daily cleanup cron; delete-account hook; Vitest tests for limits, ownership and the magic-byte check; ownership checks reuse the 4.5 data layer; staff can read claim files; `createUpload` goes through the shared rate limiter | todo |
| 4.11 | **Background jobs** ([engineering.md §11](../../engineering.md#11-background-processing)): `jobs` table used as an outbox (enqueued in the same transaction), run straight away with `waitUntil`, per-minute Vercel Cron retries with exponential backoff, `dead` after 5 attempts and shown in the admin area; idempotent handlers; verification/reset emails and the upload cleanup move onto it; integration test: a failing job retries with backoff and lands in `dead` after 5 attempts | todo |

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
| Integration | DB constraints refuse bad rows: rating 6, a negative amount, a second policy for one quote, an unknown status, a missing `NOT NULL` field | 4.2 | yes |
| Unit | Auth input schemas; password rule (min 10 chars); breached-password check with the HIBP call mocked | 4.4 | yes |
| Component | Sign up, sign in, reset and 2FA forms: validation messages, Google button, 6-digit code input | 4.3–4.6 | yes |
| Integration | Permission suite: every protected function × guest, customer A, customer B, handler, admin, including cross-user ids ([§7](../../engineering.md#tests)) | 4.5 | yes |
| Integration | `withTx` rolls back every write on a thrown error; `withIdempotency` returns the first result on a repeat and refuses the same key with a different payload; `limit()` sliding window allows N then returns 429 | 4.5 | yes |
| Integration | Staff functions refused without 2FA set up or with a stale session; password change revokes other sessions; "sign out everywhere" ends them all | 4.6 | yes |
| Integration | Delete account removes the user's rows and R2 objects (S3 client mocked) and writes an `audit_log` row | 4.7 | yes |
| Integration | Reference-data upsert is idempotent and keyed by `rating_version`; the module-scope cache returns the same tables for the same version | 4.8 | yes |
| Integration | Seed script run twice gives the same row counts | 4.9 | yes |
| Integration | `createUpload` enforces kind, count, MIME and size limits and parent ownership; `confirmUpload` rejects a renamed `.exe` by magic bytes; `getFileUrl` refuses another user's file; staff can read claim files | 4.10 | yes |
| Component | Upload client in real Chromium: a large JPEG comes out as WebP ≤ 2048 px with no EXIF; thumbnail is 400 px | 4.10 | yes |
| Unit + Integration | Backoff calculation (unit); a failing job retries with backoff and lands in `dead` after 5 attempts; a rolled-back transaction leaves no job; a handler run twice has one effect | 4.11 | yes |
| E2E | Sign up → sign out → sign in; a seeded staff account is sent to 2FA setup before any staff page; axe on the auth pages. Turnstile uses Cloudflare's test keys | 4.4–4.6 | yes |
| Manual | Google sign-in on staging and production; the verification email arrives; the 12 MB phone photo check with `exiftool` | 4.4, 4.10 | yes |

## Exit criteria

- `integration` project passes in `ci`; auth E2E and axe pass on the preview.
- Full auth round-trip works on the deployed URL.
- Permission test suite passes (every protected function × 5 actors); customer B is refused customer A's policy, claim and file ids.
- A new staff account can't open staff pages until 2FA is set up; Google sign-in works on staging and production; each staff action writes an `audit_log` row.
- Seed script reruns without duplicates.
- Double-submitting any important write returns the first result (idempotency tests); a failed job retries and then lands in `dead`.
- A 12 MB phone photo uploads straight to R2 (network tab: `PUT` to R2, not Vercel), lands as WebP of at most 2048 px with no GPS EXIF (`exiftool`); a renamed `.exe` is rejected; user B can't get user A's file URL.
- Deployed and tagged.
