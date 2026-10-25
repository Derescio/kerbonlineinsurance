# Kerb

The website for Kerb, a fictional UK car insurer: quote, buy (fake payment), manage a policy, file a claim, and ask Kerbie, the AI assistant. It's a demo, so no real cover is sold.

Built with [Vite+](https://viteplus.dev) and [TanStack Start](https://tanstack.com/start). The build plan is in [plan/](plan/README.md).

## Run it

Needs [Vite+](https://viteplus.dev/guide/) (`vp`). It manages Node and pnpm for you.

```sh
vp install        # dependencies
vp config         # once per clone: installs the pre-commit hook
vp dev            # dev server on http://localhost:3000
```

Copy `.env.example` to `.env.local` when a slice needs real values.

## Checks

```sh
vp check          # format, lint and type-check
vp check --fix    # fix what can be fixed
vp test           # Vitest
vp build          # production build
```

The pre-commit hook runs `vp staged`, which formats and lints only the staged files.

## Layout

```
src/
  routes/        pages and API routes (TanStack file routes)
  components/    Kerb design system (phase 2)
  features/      quote, claims, account, kerbie: UI + server functions per feature
  server/        server-only code: env, cache headers, db, auth
  lib/           shared utilities (browser-safe)
  styles/        tokens + global CSS (phase 2)
public/          favicons and static files
plan/            the build plan
```

Folders appear when the first slice needs them. Imports use the `#/` alias for `src/`, for example `import { env } from "#/server/env"`.
