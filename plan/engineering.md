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
  - `BETTER_AUTH_SECRET` follows the database, not the environment: Development, Preview and Staging share `dev`, so they share one value, and Production has its own. Better Auth encrypts TOTP secrets with it (4.6), so a mismatch fails 2FA with `invalid tag`, and rotating it disables every enrolled authenticator.
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
- **Two connection strings per environment, two roles** (4.5b):
  - `DATABASE_URL` (Neon pooled, used by the app) connects as `kerb_app`, a role that owns nothing and can't change `audit_log`.
  - `DATABASE_URL_UNPOOLED` (direct) is the owner, used by migrations and the deploy step: PgBouncer transaction mode doesn't keep the session lock `drizzle-kit migrate` takes.
  - Both with `sslmode=verify-full`.
- **The app role:** `0010_app_role` creates `kerb_app` without login rights; a one-line `ALTER ROLE kerb_app WITH LOGIN PASSWORD '…'` in Neon's SQL editor turns it on (Neon's console would make the role a `neon_superuser` member, which can write every table). Default privileges give new tables `kerb_app`'s grants (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), and `src/server/db/app-role.int.test.ts` lists every table's expected grants, so a table that needs tighter rules fails the test until it's listed. `vp run db:check-app-role` checks a branch (§7).

- **Backward-compatible migrations (expand/contract):** add the column or table, backfill, switch the code over, and only drop the old part in a later release. Vercel keeps serving the old deployment while the new one builds.
- **Reference data** (vehicle catalogue, rating tables; 4.8): `scripts/reference-data.ts` (`vp run db:reference`) runs after a successful migrate on the same builds, as the owner. Sources are typed files under `src/server/reference/`, validated before anything is written; it's safe to run twice or from two builds at once (advisory lock).
  - **A rating version never changes once in the database.** Each stores a `content_hash`; a deploy that finds the same version with different tables fails the build ("car v1 … add v2 instead"). A new version retires the active one in the same transaction.
  - **Catalogue rows are corrected in place, never deleted.** A variant dropped from the source is set `is_active = false`, so quotes that link to it still join.
  - **`kerb_app` can only read** the six reference tables (`0015`); `vp run db:check-app-role` checks it.
  - Locally, run `vp run db:reference` after `vp run db:migrate`.
- **Seed data on `dev` (4.9):** `vp run db:seed` writes the synthetic cast (named accounts on `SEED_INBOX`, password `SEED_PASSWORD`, staff 2FA from `SEED_TOTP_SECRET`) and 12 months of synthetic customers, all `users.is_synthetic`. Run by hand from your machine; never in a Vercel build, and it refuses any host but `SEED_DATABASE_HOST`. One transaction; a second run prints "Already seeded" and changes nothing.
  - **To rebuild `dev`:** `vp run db:reset-dev -- --confirm <dev host>` empties it and runs migrations, reference data, the seed and the app role check. Never use Neon's "Reset from parent" (it copies `prod`'s data). Step by step: [dev-database.md](dev-database.md).
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
| **Server memory** | Vehicle catalogue and rating tables cached in module scope per function instance (`src/server/data/reference.ts`): rating tables keyed by rating version id, which never changes; the catalogue loaded once, since it only changes in a deploy. Cached objects are frozen. The active version is looked up each time, so a new one takes effect at once. | 4.8, 5.4 |
| **External calls** | postcodes.io results stored in a `postcode_areas` table, so each postcode is looked up once | 5.2 |
| **Database** | Neon pooled connection + node-postgres pool (`attachDatabasePool`, Fluid compute); indexes on foreign keys and hot filters (`user_id`, `status`, `created_at`); paginated lists; relational queries (no N+1) | 4.1, 4.2 |
| **Review photos** | Served via `/media/r/:fileId` with `public, max-age=31536000, immutable`; Vercel's CDN caches them, and R2 has no egress fees | 6.9 |
| **Kerbie panel** | Lazy-loaded on first open, so chat code is never in the landing bundle | 7.2 |
| **AI cost** | Prompt caching on the stable prefix (voice rules + knowledge file + tool definitions); low effort; short max output; long threads summarised; per-user limits | 7.2, 7.3 |
| **No Redis (yet)** | CDN + memory + Postgres cover caching and quotas. Add Upstash Redis (Vercel Marketplace) only if the launch load test shows a need. | 8.6 |
| **Abuse / load** | Vercel Firewall rate-limit rules on `/api/*` and auth routes (IP level); Postgres counters for per-user AI quotas | 1.5, 7.3 |
| **Budgets** | Lighthouse CI on previews: mobile LCP < 2.5 s, CLS < 0.1, landing JS < 150 KB gzip. Vercel Speed Insights on production. | 8.7 |

## 6. File storage (Cloudflare R2)

Uploads in four places: claim damage photos, claim documents (PDF), review photos, and photos sent to Kerbie. One shared foundation (slice 4.10) does the work; feature slices just use it. 4.10 supports the first three; Kerbie's `kerbie_image` kind, its parent column and its 30-day expiry come with the chat tables in Phase 7.

**Key constraint:** Vercel functions only accept request bodies of about 4.5 MB, so **files never pass through our server**. The browser uploads straight to R2 using a short-lived signed URL.

### Buckets

| Bucket | Used by | Access |
|---|---|---|
| `kerb-dev` | local, previews, staging | private |
| `kerb-prod` | production | private |

- **No public bucket and no `r2.dev` URL:** Cloudflare rate-limits `r2.dev` and doesn't support it for production traffic.
- **Credentials:** one R2 API token per bucket, scoped to object read/write on that bucket only. Env vars per Vercel environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- **Placement:** both buckets in Western Europe as a location hint, with no EU jurisdiction, on the standard endpoint `https://<account-id>.r2.cloudflarestorage.com` (path-style URLs).
- **CORS:** `PUT`/`GET`/`HEAD` only from that environment's origins (dev: localhost, staging and `*.vercel.app`; prod: the production URL). CORS isn't the security boundary: only the server issues upload links, each for one file of one type and size.
- **Client:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (server-only), behind a small `ObjectStore` interface (`src/server/uploads/store.ts`) with an in-memory fake for the integration tests. Checksums only when required, or the SDK signs a CRC32 that a browser's plain `PUT` can't send.
- **Checking the bucket:** `vp run uploads:check-r2` puts, heads, reads, signs a `GET` for and deletes one object in the bucket from `.env.local`.

### Upload flow

1. **Prepare in the browser** (`src/features/uploads/client.ts`):
   - **Images:** resize to at most 2048 px, re-encode as WebP, and make a 400 px thumbnail. Re-encoding **strips EXIF, including GPS**, which matters for privacy: damage photos are often taken at home. HEIC is converted where the browser can decode it; where it can't, the page asks for a JPEG.
   - **Safari:** its canvas can't encode WebP, so there the photo and thumbnail are JPEGs instead (canvas output drops EXIF just the same) and the key ends `.jpg`.
   - **PDFs:** uploaded as they are.
2. **`createUpload`** (server function):
   - checks the session, the kind, parent ownership, per-kind limits, MIME type and size
   - writes a `files` row with status `pending`
   - returns presigned `PUT` URLs (5 min) with content type and length signed in
   - counts `pending` and `ready` files towards the limit, with the parent row locked, so two tabs can't sneak an extra one in
   - goes through the shared rate limiter: 60 per user per hour
3. **Upload:** the browser `PUT`s directly to R2, with a progress bar.
4. **`confirmUpload`:**
   - `HEAD`s the object and checks the first bytes' magic number (JPEG/PNG/WebP or `%PDF`)
   - marks the row `ready`; on a mismatch, deletes the object and marks it `rejected`
5. **View:**
   - **Private files** (claims, Kerbie): `getMyFileUrl` checks ownership and returns a presigned `GET` (5 min). Staff with `claims.read_all` use `staffGetFileUrl`: claim files only, never on their own claim, and each view writes a `file.viewed` audit row.
   - **Who may upload:** the claim's own customer while it's `draft`, `received`, `assessing` or `approved`; the review's own customer while it's `pending`. Anyone else's is `NOT_FOUND`.
   - **Removing:** `deleteMyFile` works only on a draft claim or a pending review. A submitted claim's evidence is a record and stays.
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
  - lifecycle: `status` (`pending` / `ready` / `rejected` / `deleted`), `created_at`, `confirmed_at`, `purged_at` (when the objects left R2)

  It holds metadata only, never the original filename, and becomes a dataset for the data video. Rows are never deleted. `owner_user_id`, `claim_id` and `review_id` are `ON DELETE SET NULL`, so a removed account or draft leaves a `deleted` row with no personal link.
- **Object keys:** `{kind}/{userId}/{fileId}.webp|jpg|pdf` (+ `-thumb.webp|jpg`). Kind first, so R2's own expiry rules can work per kind (Phase 7 puts a 30-day rule on `kerbie_image/`).
- **Daily Vercel Cron** `/api/cron/uploads-cleanup` at 03:30 UTC (protected by `CRON_SECRET`) deletes the objects of:
  - `pending` uploads older than 24 h
  - `rejected` uploads
  - `deleted` files whose objects are still there (`purged_at` empty)

  `vp run uploads:cleanup` runs it by hand (`NOW=` works), since Vercel Cron only calls Production. 4.11 moves it onto the jobs table.
- **Delete account** (the immediate path of 4.7, for an account with no insurance records) goes through `deleteUserFiles(tx, userId)` inside the delete's transaction. The user's rows become `deleted`, and their objects are deleted **after** the commit, so a rollback never leaves rows pointing at missing files. If R2 is down then, the cleanup takes them.
- **Closing an account** (the 30-day path) keeps the files of submitted claims for as long as the claim's records are kept. Files on draft claims and on reviews become `deleted` in `closeAccountRows`, because those drafts and reviews go; the next cleanup deletes their objects.

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
- **2FA:** the `twoFactor` plugin (TOTP + backup codes). Optional for customers (setup at `/account/two-factor`; Settings in 6.3). **Required for staff** before any staff page loads. How it's enforced: [Two-factor and sessions](#two-factor-and-sessions-46).
- **Sessions:**
  - DB-stored, in `httpOnly`, `Secure`, `SameSite=Lax` cookies
  - 7 days, refreshed with use, with a 5-minute cookie cache
  - "sign out everywhere"; all other sessions revoked on password change
  - staff actions need a fresh code (`requireFresh`)
- **Rate limits:** Better Auth's limiter backed by the database (serverless has no shared memory) on sign-in, sign-up, reset and 2FA, plus the Vercel Firewall rules.
- **Origins:** `trustedOrigins` per environment: the production URL; the staging URL; on Preview the deploy URL plus `https://kerbonlineinsurance-*-damion-wilsons-projects.vercel.app` (this project's previews only, never every `*.vercel.app`); `http://localhost:3000` locally.
- **Env vars (per environment):** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (unset on Preview), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_PROXY_SECRET` (Staging and Preview, same value), `RESEND_API_KEY`, `EMAIL_FROM`, `VITE_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

### Two-factor and sessions (4.6)

- **The stamp:** `sessions.two_factor_verified_at` says a session passed the code. It's a Better Auth `additionalFields` entry with `input: false`, so `/update-session` can't set it. Only our hooks write it, after a code is accepted on `/two-factor/verify-totp` or `/two-factor/verify-backup-code`:
  - a sign-in code or the setup code stamps the session that survives (`ctx.context.newSession`), never the returned token, whose session the setup step has just deleted
  - a signed-in code (the Google challenge, the "Confirm it's you" dialog) stamps the same session
  - a customer's trusted-device sign-in is stamped when it's created; a staff member's never is
- **A session that owes a code** (2FA on, no stamp: a Google sign-in, a session from before 2FA was turned on, staff on an old trust cookie) can reach only an **allowlist** of Better Auth endpoints: the two verify paths, `/sign-out`, `/get-session`, `/sign-in/social`, `/oauth-proxy-callback` and `/callback/*`. Everything else answers `TWO_FACTOR_CHALLENGE` (401). It's an allowlist so an endpoint added in a Better Auth upgrade starts out refused; otherwise an owing session could read the TOTP secret, make new backup codes or turn 2FA off. The check reads the session from the database (cache off), and when the row is gone it also checks the cookie-cached copy, so signing out and replaying the old cookies doesn't get through.
- **`kerbTwoFactor()`** (`src/server/auth/two-factor.ts`) holds all of this as a Better Auth plugin registered straight after `twoFactor()`. Better Auth runs `hooks.before`/`hooks.after` from the options before any plugin's, so a hook in `auth.ts` would run before `twoFactor()` had deleted the half-made session on a password sign-in that owes a code, and would record (or stamp) a session that's about to go. As a later plugin it sees what `twoFactor()` did. The before hook hands the after hooks what they need (the mode, the user, the session it arrived with) as `kerb2fa` on the endpoint context. Its own lookup errors fail closed (logged by name, generic 500).
- **Our reads:** `Actor.twoFactor` is `{ enabled, verifiedAt }`. `requireUser` and `requirePermission` refuse an owing session with `TWO_FACTOR_CHALLENGE`, and `requirePermission` refuses staff with 2FA off with `TWO_FACTOR_REQUIRED` (403). Route guards (`requireSignedIn`, `_staff`'s `getStaffAccess`) send them to `/login/two-factor` (frame 09) or `/account/two-factor` (frame 12).
- **Staff rules:** a staff verify has `trustDevice` forced off, so no trust cookie is set; `/two-factor/disable` is refused for staff (`TWO_FACTOR_REQUIRED`). "Staff" here means active with at least one role.
- **Freshness:**
  - `requireFresh(actor)` wants a code within 2 hours (`STAFF_FRESH_MS`), else `SESSION_NOT_FRESH` (403), which opens the "Confirm it's you" dialog (frame 13). 6.10 calls it from staff writes.
  - Someone with no password (Google only) can turn 2FA on or off, read the setup secret or make new backup codes only with a session under 10 minutes old (`PASSWORDLESS_FRESH_MS`); a password user gives the password, as the plugin requires.
- **Lockout:** a sign-in challenge allows 5 tries; 10 wrong codes in a row lock code checks for 15 minutes. The plugin does this only at sign-in, so our hooks apply the same rule to signed-in checks on the same `two_factors` columns (one lockout across both modes; a good code resets it). Both verify paths also have a rate limit of 10 per 15 minutes per IP. Every wrong code records `two_factor_failed`.
- **Backup codes** are ten `XXXXX-XXXXX` from `A–Z0–9`, so the form can upper-case what's typed. A backup code can't confirm setup (`TWO_FACTOR_NOT_ENABLED`), and `disableSession` is refused on the verify paths.
- **Recording:** `two_factor_enabled`, `two_factor_disabled`, `backup_codes_regenerated`, `two_factor_passed`, `two_factor_failed` (methods `totp`, `backup_code`) go to `security_events`. A password sign-in with 2FA records `sign_in` when the code is accepted, not at the password. Turning 2FA off also writes `two_factor.disabled` to `audit_log` in the after hook; Better Auth's write isn't in our transaction, so the before hook refuses the request if the audit keys don't parse, and a database failure between the two writes is the one accepted gap.
- **Sign out everywhere** (`signOutEverywhere`, `src/server/auth/sessions.ts`) deletes the user's sessions and writes `sessions.revoked_all` in one `withTx`, so it fails closed; `signed_out_everywhere` is recorded after the commit. It doesn't call Better Auth's `/revoke-sessions`, which would delete outside the transaction. With no `secondaryStorage` and no session delete hook the two do the same thing; a unit test fails if either is added.
- **Password change:** our before hook forces `revokeOtherSessions: true`. Better Auth then ends every session and signs the user in with a new one, and our after hook copies the old session's stamp onto it, so staff aren't asked for a code straight after. A reset ends every session (4.4). Both record `sessions_revoked_on_password_change`.
- **The cookie cache:** Better Auth's cached `getSession` can show a revoked session as alive, or a just-stamped one as unstamped, for up to 5 minutes. Nothing decides access from it: `getActor` and the guards read with the cache off.
- **Lost phone and backup codes:** `vp run auth:reset-two-factor <email>` turns 2FA off, clears trusted devices and sessions and writes `two_factor.reset`, in one transaction. The next staff page sends them to setup.

### Account closure (4.7)

- **Two paths, chosen by what is on file.** Records on file means the user's customer has any `policies`, `payments` or `bundles` row (any status, so a refunded payment on an unbought quote counts). Retention wins every conflict; the database's `RESTRICT` on history stays as the safety net.
  - **Nothing on file: immediate delete** (`deleteAccount`, `src/server/account/delete.ts`). One transaction locks the `users` row, writes `account.deleted`, calls `deleteUserFiles`, then deletes the user; the cascades remove the rest and `record_delete` tombstones every copied row. Any throw rolls everything back. It skips `withIdempotency` (its key row would cascade away with the user): a second request finds the user gone and gets `UNAUTHENTICATED`, which the screen treats as "already deleted" only after its own lost response. The server function clears the session cookies so the browser is really signed out.
  - **Records on file: closure** (`requestClosure`, `cancelClosure`). A row in `account_closures` starts a 30-day window (`CLOSURE_WINDOW_DAYS`; `closes_at = requested_at + 30 days` is enforced by a `CHECK`). The customer can still sign in, sees a banner on every signed-in page and can keep the account with one click. Requesting ends the user's other sessions and keeps the current one.
- **Proof at the moment of confirming** (`confirmIdentity`, `src/server/account/confirm.ts`): the password, or for a Google-only user a session under 10 minutes old (`PASSWORDLESS_FRESH_MS`); a 2FA user also gives a TOTP or backup code, which counts towards 4.6's lockout. A trusted-device cookie doesn't skip it. Request, cancel and delete each have their own limit bucket (`account.close`, `account.keep`, `account.delete`) with the same rule (`CLOSE_LIMIT`, 5 per hour per user). Request and delete count every attempt before the proof runs, so a wrong password counts (`auth.api` calls skip Better Auth's own limiter); request proves identity in `defineWrite`'s `before` step, after the replay lookup, so a replay is neither counted nor proved again. Staff get `STAFF_ACCOUNT` (403): an admin deactivates their account.
- **The daily run** is `runClosures(db, now, deps)`, called by the Vercel Cron route `/api/cron/account-closures` (once a day, `vercel.json`). The route needs `CRON_SECRET` as a Bearer header: anything else is 401, and an unset secret is a 500. Each due closure (`closes_at <= now`) runs in its own `withTx`, locking the `users` row then the closure row `FOR UPDATE SKIP LOCKED`, so a customer cancelling at the same moment either wins or gets `ACCOUNT_CLOSED`; one failure doesn't stop the rest. A failure outside that loop is logged through `logSafeError` and answers a `no-store` 500. 4.11 moves it onto the jobs table.
  - **Vercel Cron only calls Production deployments.** On Staging and Preview the job never runs, so run it there by hand with `vp run account:run-closures` (below).
  - **An open claim** (`received`, `assessing`, `approved`) holds the closure: `held_since` and `hold_reason` are set once (`account.closure_held`, held email) and later runs do nothing until the claim is settled or declined. A live policy doesn't hold it, and closing never cancels cover.
  - **No open claim:** the account is scrubbed and `closed_at` and `retain_until` are set in one transaction, with `account.closed`.
- **What closure keeps and removes.** Kept: the `users` row (email becomes `closed+<userId>@closed.invalid`, name `Closed account`, image cleared, not verified), `customers`, policies, non-draft claims and their events, messages, settlements, payments, bundles, quotes with a payment or bundle, `security_events` and `audit_log`. Removed: `accounts`, `sessions`, `two_factors`, unused reset-password `verifications`, `idempotency_keys`, `rate_limits` rows for the user, draft claims, quotes that never became a policy and have no payment or bundle, notifications and reviews. The freed email can sign up again as a separate account. `resolveActor` returns null for a closed user.
- **Retention** is illustrative (`RETENTION` in `src/server/account/constants.ts`: insurance records 7 years after closure, security events 12 months). `retain_until` is stored; nothing purges at that date yet (a later slice, which needs 0004's append-only trigger to allow it). The privacy notice reads its table from the same constant.
- **Audit actions** (entity `user`): `account.deleted`, `account.closure_requested`, `account.closure_cancelled`, `account.closure_held`, `account.closed`. Rows hold only the user id.
- **By hand:** `vp run account:run-closures` runs the real `runClosures`. `NOW=<ISO date>` selects closures due at that time (for example 31 days on) without waiting; `closed_at` still uses the database clock.
- **9.7's erasure test** uses the immediate-delete path (an account with nothing on file); a closed account keeps its rows by design.

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
   - `requirePermission(actor, permission)`, which refuses anyone who isn't active staff holding that permission, and staff without 2FA or owing a code (4.6)
   - `requireFresh(actor)` for staff actions that need a recent code (4.6)
   - there is no `requireRole`: nothing outside `permissions.ts` checks a role name
2. **Scoped data access** (`src/server/data/*`):
   - Customer functions take the owner id **from the session only**, never from client input, and always filter by it.
   - Staff functions are separate (`staff*`) and need an active `staff_members` row holding the right permission.
   - Someone else's record is `NOT_FOUND`, the same answer as an id that doesn't exist, so ids can't be probed. Staff functions answer `FORBIDDEN` to anyone without the permission.
   - Pages, Kerbie tools and uploads all use these functions, so there's one place the rules live. A lint rule keeps it that way: `getDb` and the schema (except `schema/values`) can't be imported outside `src/server/data/`, `src/server/auth/`, `src/server/audit/` (only to write `audit_log`), `src/server/db/`, `scripts/` and tests, and `ROLE_PERMISSIONS` only inside `src/server/auth/permissions.ts`.
3. **Route guards** (`beforeLoad`): redirects for UX only. The server is the security boundary.
4. **Audit log:** `audit_log` records:
   - staff actions: claim status, referral decisions, roles, review decisions
   - staff **views** of customer data: opening a claim, a claim file or a referral (`*.viewed`), written by the staff data functions (`staffGetClaim`, `staffGetReferral`) so no page can skip it. A refused view (not found, conflict of interest) rolls back and writes nothing; only successful views are logged
   - staff detail routes that call these audited reads must not run them from a hover-preloaded loader (the router's `defaultPreload: "intent"` would write `*.viewed` rows for views that never happened): set `preload: false` on those routes, or call the read from a user-triggered server function
   - sensitive customer actions: password, 2FA, "sign out everywhere", address and driver changes, account deletion

   **The action list (4.6):** every action lives in one file, `src/server/audit/actions.ts` (`AUDIT_ACTIONS`: name → entity type and a plain-English description for 6.8's viewer). `audit()` takes `action: AuditAction` and gets the entity type from the list, so a typo is a type error and an action can't be paired with the wrong entity. The file imports nothing, so the scripts load it too. The database checks only the `area.verb` format, so adding an action is a line in that file and no migration; `verifyAuditChain` accepts any name, because history can hold retired ones. A snapshot test pins the list. Today: `claim.viewed`, `referral.viewed`, `staff.added`, `two_factor.disabled`, `sessions.revoked_all`, `two_factor.reset`.

   **How it's kept honest:**
   - written by `audit()` inside the same transaction as the change, so the two commit or roll back together
   - append-only: a trigger refuses `UPDATE` and `DELETE`
   - hash-chained with a keyed hash: each row stores an HMAC-SHA256 (hex) of `prev_hash` and the row's own fields, so someone with database access but no key can't rewrite history and recompute the chain. The input is a canonical JSON array of a format number, `prev_hash`, `key_version`, `created_at` (ISO, millisecond precision), actor, role, action, entity, `changes` (keys sorted at every depth), `reason`, `request_id` and `ip_hash`. The code is `src/server/audit/chain.ts`, which imports only `node:crypto`, so `auth:make-admin` signs `staff.added` with the same code
   - `audit()` takes `pg_advisory_xact_lock` inside the caller's transaction, reads the latest row and sets `created_at` to the later of now and the previous row's time, so rows never go backwards. `changes` holds strings, booleans, null, safe integers, and arrays or objects of those; anything that wouldn't round-trip through `jsonb` is refused before the insert
   - `verifyAuditChain()` (`src/server/audit/verify.ts`) reads in id order and names the first bad row: `bad_genesis`, `broken_link`, `unknown_key_version` or `hash_mismatch`. It returns `lastId` and `lastHash` for 4.11's anchor. `/admin/audit` (6.8) has a "Verify chain" button
   - **Keys:** `AUDIT_HMAC_KEYS` (`v1:base64key[,v2:…]`, each key at least 32 bytes) and `AUDIT_HMAC_ACTIVE_VERSION`, one set per Neon branch: `dev` serves Staging, Preview and Development, `prod` serves Production only. Every row records the `key_version` that signed it. To rotate, add `vN` to the list, make it the active version and keep the old ones listed; old keys only verify, and no row is rewritten. A row whose version isn't listed fails as `unknown_key_version`
   - **Fails closed:** if the keys are missing or invalid, `audit()` throws and the change it records rolls back with it. A staff member can't open a claim while auditing is broken
   - **Limitation:** the chain can't show that the newest rows were deleted, or that the whole database was restored to an earlier point, because what's left is still a valid chain. Anchoring the latest hash outside the database (4.11, in R2) closes that gap
   - ids and changed field names/values only, no emails, addresses or chat text; an IP is stored only as a hash
   - no foreign keys on `actor_user_id` / `entity_id`: deleting an account keeps its audit rows (user id only) and the chain stays valid

   **Elsewhere:**
   - sign-ins, failed sign-ins, lockouts, resets, 2FA challenges and account links go to `security_events` (4.4), unchained, so bot traffic can't flood the chain; it feeds "Recent activity" in Settings
   - business history stays in its own append-only tables: `claim_events`, `underwriting_decisions`, `kerbie_actions`; policy history in `policy_versions` (6.3)
   - **not** a generic trigger copying every row change in every table: too much volume, and it copies personal data into a second place
   - the app connects as `kerb_app`, which has only `SELECT` and `INSERT` on `audit_log` and no `TRUNCATE` anywhere, and can't drop or replace the triggers. `vp run db:check-app-role` runs against a branch's `DATABASE_URL` and checks: connected as `kerb_app`; no superuser, `CREATEROLE`, `CREATEDB` or `BYPASSRLS`, and no `neon_superuser` or `pg_*_data` membership; `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` refused (read with privilege functions, so the check never runs one); the triggers present; and the chain verifies

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

  `withTx` sets `statement_timeout` to 10 seconds and `lock_timeout` to 5 seconds for the transaction only, so a stuck query or lock can't hold a serverless connection. A test fails if `.transaction(` appears anywhere in `src/` outside `tx.ts`. A write that returns a `rejected` result (a business-rule refusal) rolls back too, with the same effect as a throw, but the caller gets the refusal back instead of an error.
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

  The browser generates a UUID when the form or card opens (`useIdempotencyKey` in `src/lib/writes.ts`). It keeps the key in `sessionStorage` so a remount in the same tab reuses it, and `rotate()` gives a new one. `writeOutcome` rotates it after an `IDEMPOTENCY_CONFLICT` and keeps it for anything else, including a network failure, so a retry is a replay.
- **How it's stored:** `idempotency_keys` holds the user, key, request hash, the response, and a 24-hour expiry. `withIdempotency()` sees a repeat and **returns the first result** instead of writing twice. The same key with a different payload or action is refused with `IDEMPOTENCY_CONFLICT` (HTTP 409): "This form was already sent with different details. Refresh the page and try again."
- **Order:** `defineWrite` checks access, then validates, then looks for a replay, then applies the rate limit, then runs the write. Replay comes before the limit, so a retry of a committed write returns its stored response even when the limit is used up, and costs no count.
- **The key row commits with the write**, in the same transaction. A throw or a `rejected` result leaves no key row, so the retry runs again. Two simultaneous calls with one key run once; the second waits for the first and gets its result.
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
  - a strict `Content-Security-Policy`: self, plus R2 for uploads and Turnstile. R2 is that environment's `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` only (never a wildcard), in `connect-src` and `img-src`. `img-src` also has `blob:`, so a picked photo can preview before it uploads. `Permissions-Policy: camera=()` stays: a phone's file picker still offers the camera. PostHog goes through the same-origin `/ingest` proxy (§13), so it adds nothing to the CSP
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
- **Errors and logs:** users see friendly messages. Logs carry ids, not personal data (no emails, addresses or chat text), and stack traces never reach the browser. Audit keys and database URLs are never logged or put in an error message; an audit failure is logged by its error name only.
  - **`PublicError` crosses to the browser with its code.** A serialisation adapter in `src/start.ts` sends `code`, `status` and `message` and nothing else (no stack, no cause), so the browser can branch on the code. A plain `Error` still crosses as its message only.
  - **Every server function uses `userMiddleware`, `permissionMiddleware` or `actorMiddleware`, or must not throw.** Access is decided there, before any input is read. The session and staff-access reads (`getSessionUser`, `getAccountSummary`, `getStaffAccess`) use none, so they return a value for a guest instead of throwing.
  - **Writes use no zod `inputValidator`.** `defineWrite` validates after the access check and returns a `ValidationFailure` with per-field messages, so a guest gets `UNAUTHENTICATED` and not a validation error.
  - **Validation failures and rejections are returned, not thrown, and not logged.** They are normal outcomes. The rate-limit refusal is logged with `console.warn` (the action name only).
- **Pre-launch review (8.9):** an OWASP-style checklist, a headers scan, a dependency audit, a secret-rotation dry run, and the permission tests (§7) green.

## 10. Rate limiting

| Layer | What | Where |
|---|---|---|
| Edge | Vercel Firewall rate-limit rules on `/api/*` **and the TanStack server-function path** (it's not under `/api`; confirm the exact prefix in 1.5), plus auth routes | 1.5 |
| Auth | Better Auth limiter (DB-backed) on sign-in, sign-up, reset, 2FA | 4.4 |
| App | One shared limiter, `limit(key, rule)` in `src/server/db/rate-limit.ts`, a Postgres sliding window in a `rate_limits` table. It returns a friendly 429 ("You're going a bit fast. Try again in a minute."). Signed-in callers are keyed by user id; guests by a keyed hash of their IP (IPv6 addresses grouped by /64), never the IP itself. The first feature that needs a rule creates `src/server/db/rate-limit-rules.ts`, and every later rule goes in it | 4.5c |
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
