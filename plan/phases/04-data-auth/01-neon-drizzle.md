# 4.1 Neon + Drizzle

**Status:** done (approved 1 Nov 2026; built 1–2 Nov 2026)
**Phase:** 04-data-auth

## Goal

A real Postgres database behind the app, with the migration pipeline and the integration test layer in place before any tables exist. Schema changes then reach `dev` and `prod` only through committed migrations, CI catches a schema change with no migration, and server code can be tested against a real Postgres.

No product tables yet: those are 4.2. This slice ships the plumbing and one empty baseline migration, so every step of the pipeline runs for real.

## Decisions for you

1. **One driver everywhere: node-postgres (`pg`) on Neon's pooled connection string, not the Neon serverless driver.** The plan says "serverless driver in the app, node-postgres in tests, chosen by env". I'd change that:
   - Vercel's Fluid compute reuses a function instance across requests, so a normal connection pool stays warm. Neon's current guidance for Vercel is `pg` + the pooled (PgBouncer) URL + `attachDatabasePool()` from `@vercel/functions`, which closes idle connections before the instance is suspended.
   - Tests then run the same driver and the same client module that production runs. With two drivers, a passing integration test says nothing about the production driver.
   - Interactive transactions just work. `withTx` (4.5) and the jobs outbox (4.11) need them; the serverless driver's HTTP mode can't do them, and its WebSocket mode is a second code path.
   - **Trade-off:** it relies on Fluid compute being on (default for projects created since 2025; you check it below). Without it, each cold instance opens its own small pool. The pooled URL absorbs that, so it still works, just less efficiently.
   - I'd update [engineering.md §4](../../engineering.md#testing) (the "chosen by env" bullet) and the 4.1 row in `phase.md` to match.
2. **An empty baseline migration.** `drizzle-kit generate --custom --name=baseline` makes `0000_baseline.sql` (a comment only) and the migration journal. The Vercel migrate step, the CI drift check and the test setup all then run against real files, and 4.2's tables arrive as `0001`. The payoff shot for this slice is one row in `drizzle.__drizzle_migrations` in the Neon console.
3. **Integration tests run in every `vp test`, locally too.** That means Docker must be running for a local `vp test`. If the test database isn't reachable, the run stops with one line telling you to run `vp run db:test:up`. The alternative (skip integration locally unless a variable is set) is easy to forget, and then "passed locally" stops meaning "will pass in CI".
4. **Postgres 18** in Neon (what the project was created with), in CI's service container and in local Docker. They must be the same major version, so both pin `postgres:18`.
5. **Migrations run in the Vercel build for Production and Staging only**, decided by `VERCEL_TARGET_ENV` (`production` or `staging`). Previews skip it: they share `dev` with staging, and `dev` is migrated by the slice author locally and by each staging deploy. Migrations use the **direct** (unpooled) URL, since PgBouncer's transaction mode doesn't hold the session lock `drizzle-kit migrate` takes. A failed migration fails the build, so the previous deploy keeps serving.
6. **No Neon ↔ Vercel integration.** The integration makes a database branch per preview, and the plan says previews use `dev`. You set the variables by hand instead (steps below).

## In scope

### Packages

- `drizzle-orm`, `pg`, `@vercel/functions` (dependencies); `drizzle-kit`, `@types/pg` (dev).

### Database client (`src/server/db/`)

- `schema.ts`: empty for now (`export {}` and a comment pointing at 4.2). `drizzle-kit` reads it.
- `client.ts`: `getDb()` returns one Drizzle instance over one `pg` `Pool`, created on first call. It reads `DATABASE_URL` itself and throws a clear error if it's missing.
  - **My call:** it doesn't go in `src/server/env.ts` yet. `env.ts` is parsed when any server module loads it (the cache headers do), so making `DATABASE_URL` required there would break the landing page in any environment without it, including local `vp preview` for E2E. It moves into `env.ts` in 4.4, when sign-in makes every page need the database.
  - Pool: `max: 5`, `idleTimeoutMillis: 5000`, then `attachDatabasePool(pool)` (a no-op outside Vercel).

### Drizzle Kit

- `drizzle.config.ts`: dialect `postgresql`, schema `src/server/db/schema.ts`, output `drizzle/`, credentials from `DATABASE_URL_UNPOOLED`, migrations table in the `drizzle` schema (the default).
- `drizzle/0000_baseline.sql` and `drizzle/meta/` (decision 2).
- Scripts in `package.json` (run with `vp run …`):
  - `db:generate`: `drizzle-kit generate`
  - `db:migrate`: `drizzle-kit migrate` (reads `.env.local`, so it targets `dev`)
  - `db:check`: `drizzle-kit check`
  - `db:deploy`: `node scripts/db-deploy.ts`
  - `db:test:up` / `db:test:down`: start and stop the local test database (`docker compose`)
- `build` becomes `vp run db:deploy && vp build`. Locally and in CI, `db:deploy` prints "skipped (not production or staging)" and exits 0.

### Deploy step (`scripts/db-deploy.ts`, decision logic in `scripts/db-deploy-plan.ts`)

- Exits 0 with a log line unless `VERCEL_TARGET_ENV` is `production` or `staging`.
- Otherwise fails fast if `DATABASE_URL_UNPOOLED` is missing, then runs `drizzle-kit migrate` and exits with its code.
- 4.8 adds the reference-data upsert after the migrate.
- Node 24 runs the `.ts` file directly (type stripping), so no extra tool.

### Test database

- `compose.yaml`: `postgres:18` on port `5433` (so it doesn't clash with a local Postgres), database `kerb_test`, data on `tmpfs` mounted at `/var/lib/postgresql` (throwaway and fast; the 18 image keeps its data under that folder, not `.../data` as in 17 and earlier).
- `TEST_DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5433/kerb_test`; CI sets it to its service container.
- `src/test/integration.setup.ts` (Vitest `globalSetup`): connects (or fails with the decision-3 message), drops the `public` and `drizzle` schemas, recreates `public`, then applies every migration with Drizzle's `migrate()`. So each run starts from an empty database.
- `src/test/db.ts`: `truncateAll()`, which truncates every table in `public` (`RESTART IDENTITY CASCADE`). There are none yet; 4.2 onwards calls it in `beforeEach`.
- The `integration` project sets `DATABASE_URL` to the test URL, so tests go through the real `getDb()`.

### Vitest (`vite.config.ts`)

- New `integration` project: node environment, `include: ["src/**/*.int.test.ts"]`, the global setup above, and `fileParallelism: false` (files share one database).
- `unit` project gets `exclude: ["src/**/*.int.test.ts"]`. Its `src/**/*.test.ts` pattern would otherwise pick them up too.

### Sample integration test (`src/server/db/db.int.test.ts`)

- `getDb()` connects and `select 1` returns 1.
- `drizzle.__drizzle_migrations` holds exactly as many rows as the journal has entries (1 for now). This is the "migrations apply cleanly to an empty DB" check, and it keeps working as 4.2+ add migrations.

### CI (`.github/workflows/ci.yml`)

- `services: postgres` (`postgres:18`, health check `pg_isready`, port 5432) and `TEST_DATABASE_URL` in the job env.
- **Drift check**, after `vp check`: `vp run db:generate`, then fail if `git status --porcelain drizzle/` prints anything ("schema changed but no migration committed: run `vp run db:generate` and commit the result"), then `vp run db:check`. Neither needs a database.
- `vp test` (unchanged) now includes the integration project.

### `.env.example`

- `DATABASE_URL=` (pooled) and `DATABASE_URL_UNPOOLED=` (direct) under "Database (4.1)", each with a one-line comment.
- `TEST_DATABASE_URL=` commented out, noting the default.
- Empty values only. I check the file for real values before you commit.

### Docs

- engineering.md §3: the scripts as named here; the deploy step gated by `VERCEL_TARGET_ENV`; migrations on the unpooled URL.
- engineering.md §4: one driver (decision 1); `vp test` needs Docker locally (decision 3).
- README "Start here": a line on `vp run db:test:up` before `vp test`.
- `phase.md` row and `build-plan.md` box ticked when it lands.

## Manual steps (Damion)

**Neon** (console.neon.tech):
1. Done 1 Nov 2026: project `kerbonlineinsurance` (`spring-moon-93195928`), **AWS Europe West 2 (London)**, Postgres **18**, Free plan.
2. Done: default branch `prod`, branch `dev` created from it.
3. For each branch, copy two connection strings from **Connect**: with **Connection pooling on** (host contains `-pooler`) and with it off. Four strings in all.

**Vercel** (project → Settings → Environment Variables):
4. Production: `DATABASE_URL` = `prod` pooled, `DATABASE_URL_UNPOOLED` = `prod` direct.
5. Staging and Preview: the same two names with the `dev` strings.
6. Settings → Functions: check **Fluid Compute** is on (decision 1).
6a. Settings → Build and Deployment: **Build Command** is the default (runs the package `build` script), not overridden to `vp build`. Otherwise the migrate step never runs.
6b. In all four strings, change `sslmode=require` to `sslmode=verify-full` (checks Neon's certificate; `pg` warns that `require` changes meaning in its next major). Tested against both `dev` strings on 1 Nov 2026.

**Local:**
7. `.env.local`: the two `dev` strings (or `vercel env pull .env.local`, which takes the Development set, so add them to Development too).
8. Docker Desktop running, then `vp run db:test:up`.

Blur the values when recording.

## Out of scope

- Any tables, including auth tables (4.2).
- The reference-data step in the deploy (4.8).
- Seed data (4.9).
- A health-check route. Nothing in the app uses the database until 4.4, and an unauthenticated route that touches the DB is one more thing to rate-limit.
- Nightly backups (8.x, [engineering.md §12](../../engineering.md#12-backups-and-recovery)).

## Sources

- [engineering.md §3](../../engineering.md#3-database-migrations-drizzle), [§4 Testing](../../engineering.md#testing), [§2](../../engineering.md#2-vercel-environments-no-custom-domain)
- Existing: `vite.config.ts` (`test.projects`), `.github/workflows/ci.yml`, `src/server/env.ts`, `.env.example`
- Drizzle docs: node-postgres connection, `drizzle-kit generate --custom`, `migrate()` from `drizzle-orm/node-postgres/migrator`
- Neon docs: connecting from Vercel with Fluid compute; pooled vs direct connections
- Vercel docs: `attachDatabasePool`, `VERCEL_TARGET_ENV`

## Files

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | packages, `db:*` scripts, `build` |
| `drizzle.config.ts` | new |
| `drizzle/0000_baseline.sql`, `drizzle/meta/*` | new (generated) |
| `src/server/db/schema.ts`, `src/server/db/client.ts` | new |
| `src/server/db/db.int.test.ts` | new |
| `scripts/db-deploy.ts`, `scripts/db-deploy-plan.ts`, `scripts/db-deploy-plan.test.ts` | new |
| `compose.yaml` | new |
| `src/test/integration.setup.ts`, `src/test/db.ts` | new |
| `vite.config.ts` | `integration` project; `unit` exclude; `drizzle/**` kept out of the formatter (generated, must match drizzle-kit byte for byte) |
| `.github/workflows/ci.yml` | Postgres service, drift check |
| `.env.example` | database variables |
| `plan/engineering.md`, `README.md`, `plan/phases/04-data-auth/phase.md`, `plan/build-plan.md` | docs |

## Steps

- [x] Damion: Neon project, branches, Vercel variables, `.env.local` (manual steps 1–7)
- [x] Packages, `drizzle.config.ts`, empty `schema.ts`, `db:*` scripts
- [x] `vp run db:generate --custom --name=baseline`; review the SQL
- [x] `client.ts` with the pool and `attachDatabasePool`
- [x] `compose.yaml`, global setup, `truncateAll()`, `integration` project, `unit` exclude
- [x] Sample integration test, passing against local Docker
- [x] `db-deploy.ts` and the `build` script; `vp run build` locally prints "skipped"
- [x] `vp run db:migrate` on `dev`; one row in `drizzle.__drizzle_migrations` in the Neon console
- [x] CI: Postgres service and drift check
- [x] Prove the gates on the PR (two throwaway commits, both reverted): a failing assertion in the sample test turns `ci` red; a table added to `schema.ts` with no migration turns the drift check red (2 Nov 2026: red at `vp test` with "expected 1 to be 99", and red at "Check for migration drift" listing `0001_….sql`)
- [x] Docs

## Tests

| Layer | What | File | Gate? |
|---|---|---|---|
| Unit | `db-deploy` skip rule: runs only for `production` and `staging`; fails fast without `DATABASE_URL_UNPOOLED` (the decision logic is a pure function, tested without running `drizzle-kit`) | `scripts/db-deploy-plan.test.ts` | yes |
| Integration | Migrations apply to an empty DB (row count matches the journal); `getDb()` connects | `src/server/db/db.int.test.ts` | yes |
| Integration | A failing integration test fails `ci`; the drift check catches a schema change with no migration | proved once on the PR with throwaway commits (screenshots in the PR) | yes |
| Component | none: no UI in this slice | | |
| E2E | none: nothing user-facing changes. The existing smoke suite still runs on the preview | | |
| Manual | Staging build log shows the migrate step ran against `dev`; a preview build log shows it skipped | | yes |

Note: `scripts/db-deploy-plan.test.ts` sits outside `src/`, so the `unit` project's `include` gains `scripts/**/*.test.ts`.

## Done when

- [x] `vp check` and `vp test` pass locally with Docker running (unit, component and integration projects all run).
- [x] With Docker stopped, `vp test` stops with the `db:test:up` message, not a stack trace.
- [x] `ci` on the PR is green with the Postgres service, and was red for each throwaway commit.
- [x] Neon console: `dev` has `drizzle.__drizzle_migrations` with one row.
- [ ] The PR's preview build log says the migrate step was skipped; after merge, the staging build log shows it ran. Build Command pinned to `pnpm run build` in Vercel (2 Nov 2026), so the step can't be skipped by the preset.
- [ ] The landing page still loads on the preview and on staging (no `DATABASE_URL` needed by anything it renders).
- [x] `.env.example` has empty values only.

`prod` gets its baseline row at the phase release, when the production build runs the migrate step for the first time.

## Commit message

`feat: Neon + Drizzle with build-time migrations, CI drift check and an integration test project on Postgres`
