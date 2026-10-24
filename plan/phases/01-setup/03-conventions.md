# 1.3 Conventions

**Status:** spec
**Phase:** 01-setup

## Goal

Set up the folder layout, import aliases and env handling that every later slice relies on, with `vp check` clean.

## In scope

- **Folder layout** (empty folders get a `.gitkeep` only if they're needed now):
  ```
  src/
    routes/        # pages and API routes (TanStack file routes)
    components/    # Kerb design system (phase 2)
    features/      # quote, claims, account, kerbie: UI + server functions per feature
    server/        # db, auth, shared server-only code
    lib/           # shared utilities
    styles/        # tokens + global CSS (phase 2)
  ```
- Path alias `~/` → `src/` in `tsconfig.json`, and confirm Vite resolves it.
- Env handling:
  - `.env.local` is gitignored.
  - `.env.example` lists every variable the project will need, with empty values.
  - `src/server/env.ts` validates server env with Zod and fails fast when something is missing.
- `.gitignore` covers `node_modules`, build output, `.env*` (except `.env.example`), and `.vercel`.
- Formatting and lint config live in `vite.config.ts`, the Vite+ way. Keep the defaults unless something clashes.
- Git hooks with Vite+ (`vp config` / `vp hooks`): pre-commit runs `vp staged`, which formats and lints only the staged files. See [engineering.md §4](../../engineering.md#4-ci-github-actions).
- `src/lib/cache.ts` with `publicCacheHeaders()`, reading `PUBLIC_CACHE_SECONDS` (default `300`), added to `.env.example` and `env.ts`. See [engineering.md §5](../../engineering.md#5-caching-and-efficiency).

## Out of scope

- Any real env values or services (phase 4 onward).

## Sources

- Vite+ config docs: https://viteplus.dev/guide/ (check, fmt and lint config in `vite.config.ts`)

## Files

- `tsconfig.json`, `vite.config.ts`, `.gitignore`, `.env.example`, `src/server/env.ts`, `src/lib/.gitkeep` (or similar).
- `kerb-online-insurance/README.md`: short "how to run" (`vp install`, `vp dev`, `vp check`, `vp test`).

## Steps

- [ ] Create the folder layout.
- [ ] Add the `~/` alias and use it once in `index.tsx` to prove it works.
- [ ] Add `zod`. Write `src/server/env.ts` with an empty schema for now and a comment listing what later phases add: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CRON_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- [ ] Write `.env.example` and update `.gitignore`.
- [ ] Write the app README.
- [ ] Set up the pre-commit hook (`vp config`) running `vp staged`; check it by committing a badly formatted file and seeing it fixed.
- [ ] Add `src/lib/cache.ts` + a Vitest test (default 300, honours the env var).
- [ ] `vp check --fix`, then `vp check`.

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0.
- [ ] An import using `~/` builds and runs.
- [ ] `git status` doesn't show `.env.local`.

## Commit message

`chore: project conventions, path alias and env validation`
