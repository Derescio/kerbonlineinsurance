# Kerb

The website for Kerb, a fictional UK car insurer: quote, buy (fake payment), manage a policy, file a claim, and ask Kerbie, the AI assistant. It's a demo, so no real cover is sold.

Built with [Vite+](https://viteplus.dev) and [TanStack Start](https://tanstack.com/start). The build plan is in [plan/](plan/README.md).

## Status

Live at https://kerbonlineinsurance.vercel.app. 18 of 63 slices done.

| Phase            |                                                                                         | Tag                |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------ |
| 1. Setup         | done                                                                                    | `s1-setup`         |
| 2. Design system | done                                                                                    | `s2-Design-System` |
| 3. Landing       | done: landing page from Figma, cookie consent, PostHog analytics and the first A/B test | `s3-landing`       |
| 4. Data and auth | next                                                                                    |                    |

Progress per slice is in [plan/build-plan.md](plan/build-plan.md).

## Run it

Needs [Vite+](https://viteplus.dev/guide/) (`vp`). It manages Node and pnpm for you.

```sh
vp install        # dependencies
vp config         # once per clone: installs the pre-commit hook
vp dev            # dev server on http://localhost:3000
```

Copy `.env.example` to `.env.local` when a slice needs real values. Analytics is optional: without `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `VITE_PUBLIC_POSTHOG_HOST` the site runs as normal, untracked, with no cookie bar.

## Checks

```sh
vp check          # format, lint and type-check
vp check --fix    # fix what can be fixed
vp test           # Vitest: unit tests, and component tests in real Chromium
vp build          # production build
```

End-to-end tests (Playwright) run against a build or a deploy:

```sh
vp build && vp preview                                   # then, in another terminal:
BASE_URL=http://localhost:4173 vp exec playwright test   # or BASE_URL=<preview URL>
```

On Vercel previews they also need `VERCEL_AUTOMATION_BYPASS_SECRET` (from `.env.local`). The `e2e` workflow runs them on every preview and staging deploy.

The pre-commit hook runs `vp staged`, which formats and lints only the staged files.

## Layout

```
src/
  routes/        pages and API routes (TanStack file routes)
  components/    Kerb design system (phase 2)
  features/      landing, quote, claims, account, kerbie: UI + server functions per feature
  server/        server-only code: env, cache headers, db, auth
  lib/           shared utilities (browser-safe), incl. analytics.ts: the only way into PostHog
  styles/        tokens + global CSS (phase 2)
public/          favicons and static files
e2e/             Playwright end-to-end tests
plan/            the build plan
```

Folders appear when the first slice needs them. Imports use the `#/` alias for `src/`, for example `import { env } from "#/server/env"`.
