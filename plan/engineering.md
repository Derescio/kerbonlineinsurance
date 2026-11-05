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
- PostHog for product analytics and A/B tests, installed with the wizard and fixed up for the CSP, cached landing page and consent (§13)

---

## 1. Branches and flow

The full rules and step-by-step: [git-workflow.md](git-workflow.md).

```text
slice/N.N-name ──PR──▶ staging ──release PR (end of phase)──▶ main ──▶ tag sN-*
                 CI + preview URL      staging deploy              production deploy
hotfix/x ──PR──▶ main, then merge main back into staging
```

- **Slice branch:** `slice/1.4-ci-pipeline`, branched from `staging`.
- **Slice PR → `staging`:** squash merge, using the slice's commit message (Conventional Commits).
- **Release PR `staging` → `main`:** one per phase, a merge commit. Then tag `sN-*` on `main`. One release per recording session.
- **Protected `main` and `staging`** (GitHub rulesets, no bypass): no direct pushes, force pushes or deletions; the `ci` check must pass. `staging` also requires the branch to be up to date. `main` does not, because each release adds a merge commit that never comes back to `staging`, so `staging` would always look out of date. Damion merges.
- **Only `staging` and `hotfix/*` may open PRs into `main`.** Rulesets can't restrict a PR's source branch, so the first step of `ci` fails any PR into `main` from another branch, and the required check blocks the merge. (PR #11 went from a work branch straight into `main` before this existed and needed a `main` → `staging` sync, PR #12.)
- **Hotfix:** branch `hotfix/<name>` from `main`, PR into `main`, then a PR `main` → `staging` (squash, the only method `staging` allows) to bring the fix back.
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
| CI (every PR) | `vp run db:generate` must leave `drizzle/` unchanged (`git status --porcelain drizzle/`) + `vp run db:check` | Catches a schema change with a missing migration |
| Staging deploy | Vercel build (`build` script → `vp run db:deploy`) runs `drizzle-kit migrate` on `dev`, then the reference-data script | Committed migrations only; proves they apply cleanly before `main` |
| Production deploy | Vercel build runs `drizzle-kit migrate` on `prod`, then the reference-data script, then the app build | If anything fails, the deploy fails and the previous version keeps serving |
| Previews | no migrate | `dev` is already migrated locally by the slice author |

- **Which builds migrate:** `scripts/db-deploy.ts` checks `VERCEL_TARGET_ENV` and only migrates for `production` and `staging`; previews, local builds and CI print "skipped". It fails the build if `DATABASE_URL_UNPOOLED` is missing. The Vercel Build Command is pinned to `pnpm run build` (an override, not the Vite preset's guess), so this step can't be skipped silently.
- **Two connection strings per environment:** `DATABASE_URL` (Neon pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct, used by migrations: PgBouncer transaction mode doesn't keep the session lock `drizzle-kit migrate` takes). Both with `sslmode=verify-full`.

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
| `e2e.yml` | Vercel's `repository_dispatch` `vercel.deployment.success` (not production), plus a manual `workflow_dispatch` with a URL. Both only run from `main`'s copy of the file, so it starts with the Phase 3 release; this project doesn't send `deployment_status` (3.4) | Playwright smoke test against the deploy URL, using Vercel's protection-bypass secret (`VERCEL_AUTOMATION_BYPASS_SECRET` in Actions secrets) | 3.4 |
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
| **Integration** | `*.int.test.ts` | Server functions and the data layer against a real Postgres: the permission suite (§7; nine actors, guest included), `withTx`, `withIdempotency`, rate limiter, job retries → `dead` | `ci.yml` with a Postgres service container; locally against a Docker Postgres | 4.1 |
| **E2E** | `e2e/*.spec.ts` | The deployed app in a browser: smoke test, then the quote and claim journeys | `e2e.yml` on every preview | 3.4 |

- **Three Vitest projects** in `vite.config.ts` (`test.projects`): `unit` (node), `component` (browser mode, Chromium) and `integration` (node + Postgres). `component` is added in 2.2 and `integration` in 4.1. Each project sets `extends: false`, and the app plugins (TanStack Start, Nitro) are skipped under `VITEST`, because they break the test runner (2.2 results). The `component` project lists its React deps in `optimizeDeps.include` so there's one copy of React.
- **Test database:** each run applies the migrations to an empty database (`src/test/integration.setup.ts` drops and rebuilds the schemas), and tests truncate tables between cases (`truncateAll()` in `src/test/db.ts`). One driver everywhere: the app and the tests both use node-postgres (`pg`) through the same `getDb()` (4.1, decision 1), so integration tests exercise the production driver. Locally that means Docker (`compose.yaml`, `vp run db:test:up`) must be running for `vp test`; without it the run stops with that instruction. Not a Neon branch per run: it's slower, costs money, and needs secrets that Dependabot PRs don't get.
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
| **Rendering** | SSR everywhere. Public pages with no user content (landing, privacy) are CDN-cached instead of prerendered: a prerendered file bakes in one CSP nonce and is served without the CSP header (3.4). Automatic route-level code splitting; intent preloading on links. | 3.x, 5.1 |
| **CDN caching** | Public pages (landing, `/reviews`): `s-maxage` + `stale-while-revalidate`. The cache time comes from **one setting**, `PUBLIC_CACHE_SECONDS` (default `300` = 5 min); set it to `1800` in Vercel for 30 min and redeploy, with no code change. It's read only by `publicCacheHeaders()` in `src/server/cache.ts`. Vehicle catalogue and postcode APIs: long public cache. Account, quote and Kerbie: `private, no-store`. | 3.4, 5.2, 6.9 |
| **Client data** | TanStack Query with `staleTime` per data type (reference data: never stale; account: short); optimistic updates in settings | 5.1, 6.3 |
| **Server memory** | Vehicle catalogue and rating tables cached in module scope per function instance, keyed by `rating_version`. They're immutable, so never stale. | 4.8, 5.4 |
| **External calls** | postcodes.io results stored in a `postcode_areas` table, so each postcode is looked up once | 5.2 |
| **Database** | Neon pooled connection + node-postgres pool (`attachDatabasePool`, Fluid compute); indexes on foreign keys and hot filters (`user_id`, `status`, `created_at`); paginated lists; relational queries (no N+1) | 4.1, 4.2 |
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

- **Email + password:** minimum 10 characters, with the Have I Been Pwned check (known-breached passwords refused; only the first 5 characters of the SHA-1 hash are sent, and the check fails open if the service is down). Email verification is required: you confirm your email before you can log in (4.4b, replacing 4.4's soft verification). The link lasts 6 hours, and a sign-up for a taken email gets the same answer as a new one, with an email to the owner instead. Emails come from `Kerb <hello@kerb.opsedsolutions.com>` (Resend, sent after the response).
- **Google sign-in:** one OAuth client per environment (production and staging redirect URLs).
  - **Previews** use Better Auth's OAuth proxy plugin, routed through the staging URL. If that proves awkward, the Google button is hidden on previews.
  - **Account linking** (4.4, decision 2):
    - only an email Google itself has verified is ever matched to a Kerb account
    - a Kerb account whose email was never verified is linked, and its password and sessions are removed (whoever set them never proved they own the address)
    - a Kerb account whose email is verified is never merged automatically: the Google sign-in is refused, and the owner logs in and presses **Connect Google** (`linkSocial`)
  - Google users are already verified, so no verification email is sent.
- **2FA:** the `twoFactor` plugin (TOTP + backup codes). Optional for customers in Settings. **Required for staff** before any staff page loads.
- **Sessions:**
  - DB-stored, in `httpOnly`, `Secure`, `SameSite=Lax` cookies
  - 7 days, refreshed with use, with a short cookie cache
  - "sign out everywhere"; all sessions revoked on password change
  - staff actions need a fresh session
- **Rate limits:** Better Auth's limiter backed by the database (serverless has no shared memory) on sign-in, sign-up, reset and 2FA, plus the Vercel Firewall rules.
- **Origins:** `trustedOrigins` per environment: the production URL; the staging URL; on Preview the deploy URL plus `https://kerbonlineinsurance-*-damion-wilsons-projects.vercel.app` (this project's previews only, never every `*.vercel.app`); `http://localhost:3000` locally.
- **Env vars (per environment):** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (unset on Preview), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_PROXY_SECRET` (Staging and Preview, same value), `RESEND_API_KEY`, `EMAIL_FROM`, `VITE_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

### Roles and permissions

| Can… | Guest | Customer | Claims handler | Admin |
|---|---|---|---|---|
| Browse, quote (unsaved), ask Kerbie general questions | ✓ | ✓ | ✓ | ✓ |
| Buy, see and change **own** policies, drivers, address | — | ✓ | — | ✓ |
| File and track **own** claims, upload own files | — | ✓ | — | ✓ |
| Write and edit **own** reviews | — | ✓ (policyholders) | — | — |
| See **all** claims and their files, change claim status, add notes and events | — | — | ✓ | ✓ |
| Review referred quotes: approve with an optional loading, or decline (6.11) | — | — | ✓ | ✓ |
| Moderate reviews | — | — | — | ✓ |
| Manage users and roles | — | — | — | ✓ |

- **Admin** can act on customer records only from staff screens, and every action there is audited.
- **Impersonation:** off, for privacy.
- **Permissions, not role names (4.5):** functions ask for a named permission, never a role. One file, `src/server/auth/permissions.ts`, maps roles to permissions. A person's permissions are the union of their roles' permissions, and a staff member can hold several roles. The map lives in code, so a change goes through a PR and the permission suite.
- **Where roles live:** `staff_members` (4.2) and `staff_roles` (4.5) together are the only source. A user with no `staff_members` row is a customer. A staff member with no roles, or a deactivated one, has no permissions. Claim assignment and referral decisions point at `staff_members`, so Postgres refuses a non-staff user there.
- **First admin:** made with `vp run auth:make-admin <email> --name "<name>"` (inserts the `staff_members` row and an `admin` row in `staff_roles`), never through the UI. Claims handlers are assigned in `/admin/users`.
- **Leaving staff:** deactivated, never deleted (`deactivated_at`; sessions revoked; open claims back to the queue), so history stays attributed.
- **Conflict of interest (reads too):** a staff action on a record that belongs to the staff member's own customer row is refused (an admin may hold a policy, but can't handle their own claim or approve their own referral). Staff queues leave out the staff member's own records, and opening one directly is refused.

**Permissions (`ROLE_PERMISSIONS`, 4.5):**

| Permission | What it allows | First used | Claims handler | Admin |
|---|---|---|---|---|
| `claims.read_all` | see every claim (except your own) with internal notes | 4.5 | ✓ | ✓ |
| `claims.update` | change status, add notes and events, settle | 6.10 | ✓ | ✓ |
| `referrals.read` | see referred quotes (except your own) | 4.5 | ✓ | ✓ |
| `referrals.decide` | approve, load or decline a referral | 6.11 | ✓ | ✓ |
| `reviews.moderate` | approve or reject reviews | 6.8 | | ✓ |
| `staff.manage` | add staff, grant and remove roles, deactivate | 6.8 | | ✓ |
| `audit.read` | the audit viewer and "Verify chain" | 6.8 | | ✓ |

`admin` is listed in full rather than as "everything", so a permission added later is never granted to admins without anyone choosing that.

### Enforcement: four layers, one rule set

1. **Server middleware** (`src/server/auth/middleware.ts`) on every protected server function:
   - `requireUser`
   - `requirePermission(actor, permission)`, which refuses anyone who isn't active staff holding that permission; 4.6 adds the 2FA and fresh-session checks inside it
   - there is no `requireRole`: nothing outside `permissions.ts` checks a role name
2. **Scoped data access** (`src/server/data/*`):
   - Customer functions take the owner id **from the session only**, never from client input, and always filter by it.
   - Staff functions are separate (`staff*`) and need an active `staff_members` row holding the right permission.
   - Someone else's record is `NOT_FOUND`, the same answer as an id that doesn't exist, so ids can't be probed. Staff functions answer `FORBIDDEN` to anyone without the permission.
   - Pages, Kerbie tools and uploads all use these functions, so there's one place the rules live. A lint rule keeps it that way: `getDb` and the schema (except `schema/values`) can't be imported outside `src/server/data/`, `src/server/auth/`, `src/server/db/`, `scripts/` and tests, and `ROLE_PERMISSIONS` only inside `src/server/auth/permissions.ts`.
3. **Route guards** (`beforeLoad`): redirects for UX only. The server is the security boundary.
4. **Audit log:** `audit_log` records:
   - staff actions: claim status, referral decisions, roles, review decisions
   - staff **views** of customer data: opening a claim, a claim file or a referral (`*.viewed`), written by the staff data functions so no page can skip it (4.5b; the 4.5 functions do not write them yet)
   - sensitive customer actions: password, 2FA, "sign out everywhere", address and driver changes, account deletion

   **How it's kept honest:**
   - written by `audit()` inside the same transaction as the change, so the two commit or roll back together
   - append-only: a trigger refuses `UPDATE` and `DELETE`
   - hash-chained: each row stores `sha256(prev_hash ‖ row)`; `verifyAuditChain()` finds the first altered or missing row, and `/admin/audit` (6.8) has a "Verify chain" button
   - ids and changed field names/values only, no emails, addresses or chat text; an IP is stored only as a hash
   - no foreign keys on `actor_user_id` / `entity_id`: deleting an account keeps its audit rows (user id only) and the chain stays valid

   **Elsewhere:**
   - sign-ins, failed sign-ins, lockouts, resets, 2FA challenges and account links go to `security_events` (4.4), unchained, so bot traffic can't flood the chain; it feeds "Recent activity" in Settings
   - business history stays in its own append-only tables: `claim_events`, `underwriting_decisions`, `kerbie_actions`; policy history in `policy_versions` (6.3)
   - **not** a generic trigger copying every row change in every table: too much volume, and it copies personal data into a second place
   - optional (8.9): the app connects as a Postgres role without `UPDATE`/`DELETE` on the audit tables

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
- **Claim status rulebook** (`src/features/claims/status.ts`): only allowed moves, `draft → received` (submit), `received → assessing → approved | declined`, then `approved → settled`. It's enforced in code and covered by tests.
- **Concurrent edits:** `claims` and `policies` carry a `version` column. An update with a stale version is refused ("This claim changed since you opened it"), so two staff can't overwrite each other.
- **Immutable history:** quotes keep their price breakdown and `rating_version`; `claim_events` and `audit_log` are append-only.

### Idempotency

- **Every important write takes an idempotency key:**
  - pay and start cover
  - submit a claim
  - post a review
  - settings changes
  - staff status changes
  - staff referral decisions
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
  - a strict `Content-Security-Policy`: self, plus R2 for uploads and Turnstile. PostHog goes through the same-origin `/ingest` proxy (§13), so it adds nothing to the CSP
  - one deliberate exception, `style-src-attr 'unsafe-inline'` (2.5): React writes `style` props as attributes in server HTML, which a nonce can't cover. Style attributes can't run script and can't load off-site resources (`img-src`/`font-src 'self'`); scripts, `<style>` and stylesheets stay nonce/self-only
  - `Strict-Transport-Security`
  - `frame-ancestors 'none'`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (camera only where uploads need it)
  - `X-Content-Type-Options: nosniff`
- **CDN cache and the CSP nonce** (3.4): a CDN-cached page (`publicCacheHeaders()`) shares one nonce across visitors for the cache window, with the HTML and header cached together. That's only allowed on pages with **no user content** (landing, privacy, `/reviews` only if reviews stay plain text). Anything per-user or with user input stays `private, no-store`.
- **Safe rendering:**
  - Reviews and claim notes are rendered as **plain text**.
  - Kerbie's replies are rendered as limited Markdown with raw HTML stripped and links restricted to Kerb pages.
  - No `dangerouslySetInnerHTML` on user content; a lint rule flags it.
- **Bot protection: Cloudflare Turnstile** (free; usually invisible) on sign-up, password reset, review submit, and the first guest Kerbie message. The token is checked on the server. Env vars: `VITE_PUBLIC_TURNSTILE_SITE_KEY` (public), `TURNSTILE_SECRET_KEY`; Cloudflare's test keys on Preview and Development.
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
  - analytics events (server-side funnel milestones only; product analytics is PostHog, §13)
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

## 13. Analytics and experiments

PostHog does product analytics and A/B tests. It lands in 3.5. The `events` table (4.2) keeps only server-side funnel milestones (quote started, quote priced, quote referred, policy bought, claim opened) for the data video; `events.anonymous_id` holds PostHog's distinct id so Phase 9 can join the two.

- **Install:** the PostHog wizard on a branch (#36), then review its diff and apply the rules below by hand. The wizard doesn't know about the nonce CSP, so its defaults work in `vp dev` and fail in production builds.
- **Region:** US, kept for this portfolio project (31 Oct 2026). A client in the EU gets an EU project, set up by hand; a project's region can't be changed.
- **Same-origin proxy:** Nitro route rules in `vite.config.ts` send `/ingest/*` to the PostHog ingest and assets hosts. The Vercel preset turns them into edge rewrites, which pass the visitor's IP on (cookieless IDs and GeoIP need it); `api_host: '/ingest'`. The CSP stays `'self'`, and ad-blockers don't drop events. No inline snippet: posthog-js is a bundled module, so it needs no nonce.
- **One wrapper:** `src/lib/analytics.ts` (`track`, `getFlag`, the consent calls). Components never import posthog-js directly, and a test enforces it; `@posthog/react` isn't used, because its provider imports posthog-js up front. It loads with a dynamic `import()` after hydration/idle, so it stays out of the landing JS budget (§5).
- **Consent (PECR/UK GDPR):** `cookieless_mode: 'on_reject'` with `opt_out_capturing_by_default: true` (3.6; without it, pending visitors aren't counted). Until the visitor accepts, and after they reject, PostHog sets no cookies or storage and counts them with a server-side daily hash (needs Cookieless server hash mode on in the project; those events get no GeoIP or bot filtering). A consent bar opts in on accept, and footer "Cookie settings" asks again. PostHog stores the choice in the visitor's browser. Replay starts only after accept. The hero form's `?postcode=` is masked in every event (`mask_personal_data_properties` plus a `before_send` for the referrer). The privacy notice (4.7) names PostHog and links to the banner.
- **Experiments without flicker:** the landing page stays CDN-cached (one HTML per cache window for everyone), so variants are picked in the browser. Render the control by default. Test only below-the-fold or interaction-revealed elements, or reserve fixed space for the variant region and swap it when flags load, with a short timeout that falls back to the control. Server-side flags (`posthog-node`) only on SSR routes, from Phase 5.
- **Tests and CI:** PostHog is off in Vitest and Playwright unless a test turns it on (env flag), so CI sends no events.
- **Env vars:** `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` (public project key) and `VITE_PUBLIC_POSTHOG_HOST` (the region's ingest host; requests go through the proxy, it sets `ui_host`). `.env.example` holds placeholders only.
