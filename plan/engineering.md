# Engineering: how Kerb ships and stays fast

This page covers the git workflow, environments, database migrations, CI, and the caching and efficiency strategy. Slices link here instead of repeating it.

**Decided by Damion:**
- one branch + PR per slice, with `main` and `staging` each in their own Vercel environment (no custom domain)
- Neon `dev` and `prod` branches
- Drizzle migrations with his "dev creates, deploy only applies" discipline
- no Redis at the start
- public page cache time set by one env var
- uploads stored in private Cloudflare R2 buckets (§6)
- background jobs in a Postgres `jobs` table run by Vercel `waitUntil` + a per-minute Cron (§11); bot protection with Cloudflare Turnstile (§9); nightly database export to R2 (§12)
- sign-in with email + password and Google; roles customer, claims handler and admin; 2FA required for staff, optional for customers (§7)

---

## 1. Branches and flow

```text
slice/N.N-name ──PR──▶ staging ──release PR (end of phase)──▶ main ──▶ tag sN-*
                 CI + preview URL      staging deploy              production deploy
hotfix/x ──PR──▶ main, then merge main back into staging
```

- **Slice branch:** `slice/1.4-ci-pipeline`, branched from `staging`.
- **Slice PR → `staging`:** squash merge, using the slice's commit message (Conventional Commits).
- **Release PR `staging` → `main`:** one per phase, a merge commit. Then tag `sN-*` on `main`. One release per recording session.
- **Protected `main` and `staging`:** no direct pushes, the `ci` check must pass, and branches must be up to date. Damion merges.
- **Hotfix:** branch from `main`, PR into `main`, then merge `main` back into `staging`.
- **Bootstrap exception:** slices 1.2 and 1.3 commit straight to `main`. CI and protection only exist after 1.4–1.6.

## 2. Vercel environments (no custom domain)

| Vercel env | Git trigger | URL | DB (Neon) | Who can see it |
|---|---|---|---|---|
| Production | `main` | `<project>.vercel.app` | `prod` | Public |
| Staging (Pro custom environment) | `staging` | `kerbonlineinsurance-staging.vercel.app` (a `*.vercel.app` domain assigned to the Staging environment) | `dev` | Vercel Authentication: Damion only |
| Preview | every PR | per-deploy URL, posted on the PR | `dev` | Vercel Authentication |
| Development | `vp dev` | localhost | `dev` | — |

- **Env vars:** set per environment in Vercel. Local `.env.local` comes from `vercel env pull` and is never committed.
- **Separate API keys** (Anthropic, OpenAI, Resend) for production and for everything else. Spend then shows per environment, and a leaked preview key can't drain production.
- **Function region:** London (`lhr1`), next to the Neon database.

## 3. Database migrations (Drizzle)

| Where | Command | Rule |
|---|---|---|
| Local | `vp run db:generate` (`drizzle-kit generate`) → review the SQL → `vp run db:migrate` (`drizzle-kit migrate`) on `dev` | Commit the schema and migration files together. **Never `drizzle-kit push`** against a shared DB. |
| CI (every PR) | `drizzle-kit generate` must produce no new files (`git diff --exit-code`) + `drizzle-kit check` | Catches a schema change with a missing migration |
| Staging deploy | Vercel build runs `drizzle-kit migrate` on `dev`, then the reference-data script | Committed migrations only; proves they apply cleanly before `main` |
| Production deploy | Vercel build runs `drizzle-kit migrate` on `prod`, then the reference-data script, then the app build | If anything fails, the deploy fails and the previous version keeps serving |
| Previews | no migrate | `dev` is already migrated locally by the slice author |

- **Backward-compatible migrations (expand/contract):** add the column or table, backfill, switch the code over, and only drop the old part in a later release. Vercel keeps serving the old deployment while the new one builds.
- **Reference data** (vehicle catalogue, rating tables) comes from an idempotent upsert script, versioned by `rating_version`.
- **Rollback:**
  - Code: Vercel Instant Rollback.
  - Data: Neon point-in-time restore on `prod`.
  - Never undo a migration by hand. Write a new forward migration.

## 4. CI (GitHub Actions)

| Workflow | Trigger | What it does | From slice |
|---|---|---|---|
| `ci.yml` | PR to `staging`/`main`, push to both | `voidzero-dev/setup-vp` (pinned release, Node 24, `cache: true`) → `vp check` → `vp test` → `vp build`, with the Vite Task cache via `actions/cache` | 1.4 |
| `ci.yml` (+ browser) | same | Installs Chromium (`playwright install --with-deps chromium`, browser cache keyed on the Playwright version) for the `component` test project | 2.2 |
| `ci.yml` (+ step) | same | Migration drift check | 4.1 |
| `ci.yml` (+ service) | same | Postgres service container (same major version as Neon) → apply migrations → run the `integration` test project | 4.1 |
| `e2e.yml` | Vercel `deployment_status` success on a preview | Playwright smoke test against the preview URL, using Vercel's protection-bypass secret | 3.4 |
| `e2e.yml` (+ axe) | same | `@axe-core/playwright` scan of each key page; fails on `serious`/`critical` violations | 3.4 |
| `e2e.yml` (+ journeys) | same | Quote → policy (5.6), submit claim → handler approves (6.10) | 5.6, 6.10 |
| `lighthouse.yml` | same | Lighthouse CI with performance budgets | 8.7 |
| `kerbie-eval.yml` | manual `workflow_dispatch` only | Runs the Kerbie eval set. It costs money, so it never runs automatically | 7.6 |

Also:
- **Local hooks:** pre-commit runs `vp staged` (format + lint staged files), set up with `vp config`.
- **Dependabot:** weekly grouped dependency PRs into `staging`.
- **PR template:** slice link, "Done when" checklist, preview link or screenshots.
- **AI PR review (CodeRabbit):** optional, not planned. Revisit after 1.6 if a second reviewer would help. Never a required check.

### Testing

Four layers. Each one has an owner slice and runs in CI. Each phase's `phase.md` has a **Testing** section saying what that phase tests at each layer, and each slice spec lists its tests under `## Tests`.

| Layer | Files | What it covers | Runs | From slice |
|---|---|---|---|---|
| **Unit** | `*.test.ts` | Pure logic with no I/O: `priceQuote()`, the claim status rulebook, Zod schemas, helpers like `cache.ts` | `vp test` locally and in `ci.yml` | 1.2 |
| **Component** | `*.browser.test.tsx` | Rendered React components in real Chromium (Vitest browser mode, Playwright provider): states, props, keyboard and focus, form validation messages | `vp test` locally and in `ci.yml` | 2.2 |
| **Integration** | `*.int.test.ts` | Server functions and the data layer against a real Postgres: the permission suite (§7), `withTx`, `withIdempotency`, rate limiter, job retries → `dead` | `ci.yml` with a Postgres service container; locally against a Docker Postgres | 4.1 |
| **E2E** | `e2e/*.spec.ts` | The deployed app in a browser: smoke test, then the quote and claim journeys | `e2e.yml` on every preview | 3.4 |

- **Three Vitest projects** in `vite.config.ts`: `unit` (node), `component` (browser mode, Chromium) and `integration` (node + Postgres). `component` is added in 2.2 and `integration` in 4.1. Check how Vite+ exposes the Vitest `test` config when setting up the first split in 2.2.
- **Test database:** each run applies the migrations to an empty database, and tests truncate tables between cases. Tests connect with the node-postgres driver, chosen by env, because the Neon serverless driver can't talk to a plain Postgres. Not a Neon branch per run: it's slower, costs money, and needs secrets that Dependabot PRs don't get.
- **Accessibility:** an axe scan (`@axe-core/playwright`) on each key page in `e2e.yml`, failing on `serious`/`critical` violations. Added in 3.4; pages join the list as they ship. Lighthouse ≥ 95 stays as the budget in 8.7.
- **Test data:** E2E uses the seeded accounts from 4.9 (customer A, customer B, claims handler, admin with a TOTP secret known to the tests) on `dev`, and creates its own records with unique ids, so runs don't collide. Turnstile uses Cloudflare's test keys outside production.
- **External services in tests:** postcodes.io, R2 (at the S3 client boundary) and the AI model (the AI SDK's mock provider) are mocked in unit and integration tests. CI never makes paid AI calls.
- **Not tested automatically:** visual match with Figma (manual side by side, recorded on camera) and Kerbie answer quality (the 7.6 eval, manual dispatch only).
- **Coverage:** reported, not gated, except for thresholds on the code where a bug costs most: `src/features/rating`, `src/features/quote/schemas`, `src/server/auth`, `src/server/data`, `src/features/claims/status.ts`.

## 5. Caching and efficiency

The aim: fast for every visitor, and cheap and stable under a spike from the video.

| Layer | Strategy | Slice |
|---|---|---|
| **Region** | Vercel functions in London (`lhr1`) next to Neon `aws-eu-west-2`, so no DB query crosses the Atlantic | 1.5, 4.1 |
| **Static assets** | Hashed filenames, `Cache-Control: public, max-age=31536000, immutable` | 1.5 (verify) |
| **Fonts** | Self-hosted woff2, subset, preloaded, `font-display: swap`; no Google Fonts request | 2.1 |
| **Images** | AVIF/WebP in responsive sizes generated at build time; hero marked high priority with width/height set (no layout shift). Avoids paid on-demand image optimisation at spike volume. | 3.2 |
| **Rendering** | Prerender static routes (landing, privacy) with TanStack Start; SSR for the rest. Automatic route-level code splitting; intent preloading on links. | 3.x, 5.1 |
| **CDN caching** | Public pages (landing, `/reviews`): `s-maxage` + `stale-while-revalidate`. The cache time comes from **one setting**, `PUBLIC_CACHE_SECONDS` (default `300` = 5 min); set it to `1800` in Vercel for 30 min and redeploy, with no code change. It's read only by `publicCacheHeaders()` in `src/server/cache.ts`. Vehicle catalogue and postcode APIs: long public cache. Account, quote and Kerbie: `private, no-store`. | 3.4, 5.2, 6.9 |
| **Client data** | TanStack Query with `staleTime` per data type (reference data: never stale; account: short); optimistic updates in settings | 5.1, 6.3 |
| **Server memory** | Vehicle catalogue and rating tables cached in module scope per function instance, keyed by `rating_version`. They're immutable, so never stale. | 4.8, 5.4 |
| **External calls** | postcodes.io results stored in a `postcode_areas` table, so each postcode is looked up once | 5.2 |
| **Database** | Neon pooled connection + serverless driver; indexes on foreign keys and hot filters (`user_id`, `status`, `created_at`); paginated lists; relational queries (no N+1) | 4.1, 4.2 |
| **Review photos** | Served via `/media/r/:fileId` with `public, max-age=31536000, immutable`; Vercel's CDN caches them, and R2 has no egress fees | 6.9 |
| **Kerbie panel** | Lazy-loaded on first open, so chat code is never in the landing bundle | 7.2 |
| **AI cost** | Prompt caching on the stable prefix (voice rules + knowledge file + tool definitions); low effort; short max output; long threads summarised; per-user limits | 7.2, 7.3 |
| **No Redis (yet)** | CDN + memory + Postgres cover caching and quotas. Add Upstash Redis (Vercel Marketplace) only if the launch load test shows a need. | 8.6 |
| **Abuse / load** | Vercel Firewall rate-limit rules on `/api/*` and auth routes (IP level); Postgres counters for per-user AI quotas | 1.5, 7.3 |
| **Budgets** | Lighthouse CI on previews: mobile LCP < 2.5 s, CLS < 0.1, landing JS < 150 KB gzip. Vercel Speed Insights on production. | 8.7 |

## 6. File storage (Cloudflare R2)

Uploads in four places: claim damage photos, claim documents (PDF), review photos, and photos sent to Kerbie. One shared foundation (slice 4.10) does the work; feature slices just use it.

**Key constraint:** Vercel functions only accept request bodies of about 4.5 MB, so **files never pass through our server**. The browser uploads straight to R2 using a short-lived signed URL.

### Buckets

| Bucket | Used by | Access |
|---|---|---|
| `kerb-dev` | local, previews, staging | private |
| `kerb-prod` | production | private |

- **No public bucket and no `r2.dev` URL:** Cloudflare rate-limits `r2.dev` and doesn't support it for production traffic.
- **Credentials:** one R2 API token per bucket, scoped to object read/write on that bucket only. Env vars per Vercel environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- **CORS:** `PUT`/`GET` only from that environment's origins (dev: localhost + `*.vercel.app`; prod: the production URL).
- **Client:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (server-only).

### Upload flow

1. **Prepare in the browser** (`src/features/uploads/client.ts`):
   - **Images:** resize to at most 2048 px, re-encode as WebP, and make a 400 px thumbnail. Re-encoding **strips EXIF, including GPS**, which matters for privacy: damage photos are often taken at home. HEIC is converted where the browser can decode it.
   - **PDFs:** uploaded as they are.
2. **`createUpload`** (server function):
   - checks the session, the kind, parent ownership, per-kind limits, MIME type and size
   - writes a `files` row with status `pending`
   - returns presigned `PUT` URLs (10 min) with content type and length signed in
3. **Upload:** the browser `PUT`s directly to R2, with a progress bar.
4. **`confirmUpload`:**
   - `HEAD`s the object and checks the first bytes' magic number (JPEG/PNG/WebP or `%PDF`)
   - marks the row `ready`; on a mismatch, deletes the object and marks it `rejected`
5. **View:**
   - **Private files** (claims, Kerbie): `getFileUrl` checks ownership and returns a presigned `GET` (5 min).
   - **Published review photos:** served via `/media/r/:fileId`, which streams from R2 with `Cache-Control: public, max-age=31536000, immutable` and only serves photos whose review is published.

### Limits

| Kind | Types | Max size | Max count |
|---|---|---|---|
| `claim_photo` | images → WebP | 10 MB before resize | 10 per claim |
| `claim_document` | PDF | 10 MB | 5 per claim |
| `review_photo` | images → WebP | 10 MB before resize | 3 per review; published only after moderation |
| `kerbie_image` | images → WebP | 10 MB before resize | 3 per message; counts towards the Kerbie daily quota |

### Data and housekeeping

- **`files` table:**
  - identity and ownership: `id`, `owner_user_id`, `kind`, plus `claim_id` / `review_id` / `chat_thread_id` (nullable)
  - object: `object_key`, `thumb_key`, `mime`, `size_bytes`, `width`, `height`
  - lifecycle: `status` (`pending` / `ready` / `rejected` / `deleted`), `created_at`, `confirmed_at`

  It holds metadata only, which becomes a dataset for the data video.
- **Object keys:** `users/{userId}/{kind}/{fileId}.webp|pdf` (+ `-thumb.webp`).
- **Daily Vercel Cron** `/api/cron/uploads-cleanup` (protected by `CRON_SECRET`) deletes:
  - `pending` uploads older than 24 h
  - `rejected` uploads
  - Kerbie images older than 30 days
- **Delete account** removes every object and `files` row the user owns.

## 7. Authentication and authorization

### Authentication (Better Auth)

- **Email + password:** minimum 10 characters, with the Have I Been Pwned check (known-breached passwords refused). Soft email verification: a banner, not a blocker.
- **Google sign-in:** one OAuth client per environment (production and staging redirect URLs).
  - **Previews** use Better Auth's OAuth proxy plugin, routed through the staging URL. If that proves awkward, the Google button is hidden on previews.
  - **Account linking:** a Google sign-in with the same verified email links to the existing account.
  - Google users are already verified, so no verification email is sent.
- **2FA:** the `twoFactor` plugin (TOTP + backup codes). Optional for customers in Settings. **Required for staff** before any staff page loads.
- **Sessions:**
  - DB-stored, in `httpOnly`, `Secure`, `SameSite=Lax` cookies
  - 7 days, refreshed with use, with a short cookie cache
  - "sign out everywhere"; all sessions revoked on password change
  - staff actions need a fresh session
- **Rate limits:** Better Auth's limiter backed by the database (serverless has no shared memory) on sign-in, sign-up, reset and 2FA, plus the Vercel Firewall rules.
- **Origins:** `trustedOrigins` per environment (production URL; staging URL + `*.vercel.app` for dev).
- **Env vars (per environment):** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Roles and permissions

| Can… | Guest | Customer | Claims handler | Admin |
|---|---|---|---|---|
| Browse, quote (unsaved), ask Kerbie general questions | ✓ | ✓ | ✓ | ✓ |
| Buy, see and change **own** policies, drivers, address | — | ✓ | — | ✓ |
| File and track **own** claims, upload own files | — | ✓ | — | ✓ |
| Write and edit **own** reviews | — | ✓ (policyholders) | — | — |
| See **all** claims and their files, change claim status, add notes and events | — | — | ✓ | ✓ |
| Moderate reviews | — | — | — | ✓ |
| Manage users and roles | — | — | — | ✓ |

- **Admin** can act on customer records only from staff screens, and every action there is audited.
- **Impersonation:** off, for privacy.
- **First admin:** made with `vp run auth:make-admin <email>`, never through the UI. Claims handlers are assigned in `/admin/users`.

### Enforcement: four layers, one rule set

1. **Server middleware** (`src/server/auth/middleware.ts`) on every protected server function:
   - `requireUser`
   - `requireRole('claims_handler' | 'admin')`, which also checks that 2FA is set up and the session is fresh
2. **Scoped data access** (`src/server/data/*`):
   - Customer functions take the owner id **from the session only**, never from client input, and always filter by it.
   - Staff functions are separate (`staff*`) and need a staff role.
   - Pages, Kerbie tools and uploads all use these functions, so there's one place the rules live.
3. **Route guards** (`beforeLoad`): redirects for UX only. The server is the security boundary.
4. **Audit log:** `audit_log` records:
   - staff actions: claim status, roles, review decisions
   - sensitive customer actions: password, 2FA, account deletion

   Kerbie actions stay in `kerbie_actions`.

### Tests

Permission tests (Vitest integration tests, `*.int.test.ts`, against the test database from §4) call every protected server function as guest, customer A, customer B, claims handler and admin, and check each result against the table. They include cross-user access attempts: customer B asks for customer A's policy, claim or file by id and must be refused.

## 8. Data integrity and idempotency

### Integrity rules

- **The database enforces the rules too, not only Zod:**
  - foreign keys everywhere, `ON DELETE` chosen deliberately: restrict for policies and claims, cascade for a user's own drafts and files
  - `NOT NULL` by default
  - `CHECK` constraints: rating 1–5, amounts ≥ 0, valid status values
  - unique constraints: one review per policy, one policy per accepted quote
- **Money** is stored as whole pence (`integer`), never floats. Dates are `timestamptz` in UTC and shown in UK time.
- **Transactions** (`withTx` in `src/server/db/tx.ts`) wrap every multi-step write. All of it commits or none of it does:
  - accept quote → create policy (+ bundle) → audit row
  - submit claim → claim + first `claim_events` row + attach files
  - Kerbie action → change + `kerbie_actions` row
  - staff status change → claim + `claim_events` + `audit_log`
- **Claim status rulebook** (`src/features/claims/status.ts`): only allowed moves, `received → assessing → approved | declined`, then `approved → settled`. It's enforced in code and covered by tests.
- **Concurrent edits:** `claims` and `policies` carry a `version` column. An update with a stale version is refused ("This claim changed since you opened it"), so two staff can't overwrite each other.
- **Immutable history:** quotes keep their price breakdown and `rating_version`; `claim_events` and `audit_log` are append-only.

### Idempotency

- **Every important write takes an idempotency key:**
  - pay and start cover
  - submit a claim
  - post a review
  - settings changes
  - staff status changes
  - each Kerbie confirm card

  The browser generates a UUID when the form or card opens.
- **How it's stored:** `idempotency_keys` holds the user, key, request hash, the response, and a 24-hour expiry. `withIdempotency()` sees a repeat and **returns the first result** instead of writing twice. The same key with a different payload is refused.
- **Belt and braces:** buttons disable while a request is in flight, and unique constraints (for example, one policy per quote) catch anything that slips through.
- **Kerbie approvals are single-use:** a confirm card can execute once. A second tap shows "already done".
- **Jobs and crons are safe to run twice** (§11).

## 9. Security

- **Covered elsewhere:**
  - permissions and 2FA (§7)
  - private uploads with file-type checks (§6)
  - separate secrets per environment and login-protected previews (§2)
  - Kerbie scoped to the session user
- **Security headers** (set in slice 1.5, tightened as features land):
  - a strict `Content-Security-Policy`: self, plus R2 for uploads and Turnstile
  - `Strict-Transport-Security`
  - `frame-ancestors 'none'`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (camera only where uploads need it)
  - `X-Content-Type-Options: nosniff`
- **Safe rendering:**
  - Reviews and claim notes are rendered as **plain text**.
  - Kerbie's replies are rendered as limited Markdown with raw HTML stripped and links restricted to Kerb pages.
  - No `dangerouslySetInnerHTML` on user content; a lint rule flags it.
- **Bot protection: Cloudflare Turnstile** (free; usually invisible) on sign-up, password reset, review submit, and the first guest Kerbie message. The token is checked on the server. Env vars: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- **Supply chain and secrets:**
  - Dependabot security alerts and a `pnpm audit --prod` step in CI.
  - GitHub secret scanning with push protection turned on (repo setting).
  - Secrets live only in Vercel, GitHub and `.env.local`.
- **Errors and logs:** users see friendly messages. Logs carry ids, not personal data (no emails, addresses or chat text), and stack traces never reach the browser.
- **Pre-launch review (8.9):** an OWASP-style checklist, a headers scan, a dependency audit, a secret-rotation dry run, and the permission tests (§7) green.

## 10. Rate limiting

| Layer | What | Where |
|---|---|---|
| Edge | Vercel Firewall rate-limit rules on `/api/*` **and the TanStack server-function path** (it's not under `/api`; confirm the exact prefix in 1.5), plus auth routes | 1.5 |
| Auth | Better Auth limiter (DB-backed) on sign-in, sign-up, reset, 2FA | 4.4 |
| App | One shared limiter, `limit(key, rule)` in `src/server/rate-limit.ts`, a Postgres sliding window in a `rate_limits` table. It returns a friendly 429 ("You're going a bit fast. Try again in a minute.") | 4.5 |
| Per feature | Quote saves, review posts, uploads (`createUpload`), Kerbie messages (+ the daily spend cap) | 5.6, 6.7, 4.10, 7.3 |
| Bots | Turnstile on the riskiest forms (§9) | 4.4, 6.7, 7.2 |

No Redis unless the load test shows a need (§5).

## 11. Background processing

- **`jobs` table:** `type`, `payload`, `status` (`queued` / `running` / `done` / `failed` / `dead`), `attempts`, `run_after`, `last_error`, `idempotency_key` (unique).
- **Enqueue** inside the same transaction as the change that triggers the job (an outbox pattern), so a job is never lost or created for a change that rolled back.
- **Run fast:** after the response is sent, Vercel's `waitUntil` runs the job straight away.
- **Retry:** a **per-minute Vercel Cron** (`/api/cron/jobs`, `CRON_SECRET`) picks up `queued` jobs whose time has come and failed ones, with exponential backoff. After 5 attempts a job goes to `dead`, and the admin area shows dead jobs.
- **Handlers are idempotent:** safe to run twice, keyed by `idempotency_key`.
- **Jobs we know about:**
  - verification and reset emails
  - claim status emails
  - review AI check (7.7)
  - Kerbie thread summaries
  - analytics events
  - the upload cleanup (moves from its own cron onto this runner)

## 12. Backups and recovery

- **Layer 1, Neon point-in-time restore** on `prod`. Check the restore window for the current plan in 8.6; if it's too short, upgrade.
- **Layer 2, nightly export:**
  - A GitHub Action runs `pg_dump` of `prod` each night into a separate **`kerb-backups`** R2 bucket with its own token.
  - The `pg_dump` version must match Neon's Postgres version.
  - An R2 lifecycle rule deletes exports after **14 days**.
  - The workflow fails loudly (GitHub notification) if the dump fails.
- **Files:** R2 objects aren't backed up separately (my call: demo photos, re-uploadable). The `files` metadata is in the DB export.
- **Restore drill (8.8):** restore last night's export into a new Neon branch, point a preview at it, and confirm sign-in and data. Write down how long it took.
- **Targets:** data loss of at most 24 h worst case (minutes with point-in-time restore); back online within 1 h.
- **Runbook** (`plan/runbook.md`, 8.8):
  - site down → Vercel instant rollback
  - bad migration or bad data → Neon point-in-time restore to a branch, then swap
  - leaked key → rotate in Vercel/Cloudflare/Google, then redeploy
  - AI spend spike → lower the cap / switch Kerbie to fallback
  - abuse wave → tighten firewall rules
