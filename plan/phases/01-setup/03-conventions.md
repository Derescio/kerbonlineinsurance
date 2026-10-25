# 1.3 Conventions

**Status:** done
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
- `src/server/cache.ts` with `publicCacheHeaders()`, reading `PUBLIC_CACHE_SECONDS` (default `300`), added to `.env.example` and `env.ts`. See [engineering.md §5](../../engineering.md#5-caching-and-efficiency).

## Out of scope

- Any real env values or services (phase 4 onward).

## Sources

- Vite+ config docs: https://viteplus.dev/guide/ (check, fmt and lint config in `vite.config.ts`)

## Files

- `tsconfig.json`, `vite.config.ts`, `.gitignore`, `.env.example`, `src/server/env.ts`, `src/lib/.gitkeep` (or similar).
- `kerb-online-insurance/README.md`: short "how to run" (`vp install`, `vp dev`, `vp check`, `vp test`).

## Steps

- [x] Create the folder layout.
- [x] Add the `~/` alias and use it once in `index.tsx` to prove it works.
- [x] Add `zod`. Write `src/server/env.ts` with an empty schema for now and a comment listing what later phases add: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CRON_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- [x] Write `.env.example` and update `.gitignore`.
- [x] Write the app README.
- [x] Set up the pre-commit hook (`vp config`) running `vp staged`; check it by committing a badly formatted file and seeing it fixed.
- [x] Add `src/server/cache.ts` + a Vitest test (default 300, honours the env var).
- [x] `vp check --fix`, then `vp check`.

## Done when

- [x] `vp check`, `vp test` and `vp build` exit with 0.
- [x] An import using `~/` builds and runs.
- [x] `git status` doesn't show `.env.local`.

## Results (24 Oct 2026)

Changes from the spec, approved by Damion:
- **Alias `#/` instead of `~/`.** The template already set up `#/*` (Node subpath `imports` in `package.json` + `tsconfig` paths). The extra `@/*` alias was removed, so there's one way to import. Used in `__root.tsx` (`#/styles.css?url`) and the tests.
- **`publicCacheHeaders()` lives in `src/server/cache.ts`**, not `src/lib/`. It reads server env, and `lib/` is meant to be safe to import in the browser. `engineering.md` updated.
- **Favicon added** (Damion's request, pulled forward from 8.3). Built from his app-icon image (`k` + Marker square on evergreen): `public/favicon.ico` (16/32/48), `icon-192.png`, and a full-bleed `apple-touch-icon.png` (iOS rounds the corners). There's no vector logo yet; an SVG favicon can follow once the brand font is self-hosted (2.1).

What was built:
- Folders created only where code exists now: `src/server/` (env, cache). The README lists the full layout.
- `src/server/env.ts`: Zod 4 schema with `PUBLIC_CACHE_SECONDS` (default 300). `parseEnv()` throws, listing every bad variable. The comment lists what later phases add.
- `.env.example` grouped by the slice that needs each variable. `.gitignore` covers `.env*` (except the example), `*.local`, `.vercel`, build output and `.vite-hooks/_`.
- Hooks: `staged: { "*": "vp check --fix" }` in `vite.config.ts`, a committed `.vite-hooks/pre-commit` running `vp staged`, and `vp hooks enable` (sets `core.hooksPath`). Each fresh clone runs `vp config` once (in the README).
- Checked: a staged, badly formatted file came out formatted after `vp staged`. `vp check`, `vp test` (6 tests) and `vp build` pass. The dev server serves the title, favicon links and all three icon files.

## Commit message

`chore: project conventions, path alias and env validation`
