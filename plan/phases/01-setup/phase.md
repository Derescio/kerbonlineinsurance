# Phase 1: Setup

**Tag:** `s1-setup` · **Status:** spec

## Goal

Go from an empty folder to a TanStack Start app built with Vite+, checked by CI, deployed to Vercel production, staging and previews, and shipped through the full branch → PR → staging → release flow. See [engineering.md](../../engineering.md).

## Payoff shot

The browser shows "Kerb" at a `*.vercel.app` URL. A test endpoint streams words one by one. That proves the host can carry Kerbie later.

## Slices

| # | Slice | Status |
|---|---|---|
| 1.1 | [Vite+ check](01-vite-plus-check.md) | done |
| 1.2 | [Scaffold TanStack Start](02-scaffold-tanstack-start.md) | done |
| 1.3 | [Conventions](03-conventions.md) | spec |
| 1.4 | [CI pipeline](04-ci-pipeline.md) | spec |
| 1.5 | [Deploy environments](05-deploy-environments.md) | spec |
| 1.6 | [Git workflow and first release](06-git-workflow.md) | spec |

## Recording notes

- **Open on:** "I build in Next.js. Today I'm trying Vite+, and here's why."
- **Next.js comparisons to call out:**

  | Next.js | Here |
  |---|---|
  | `create-next-app` | `vp create @tanstack/start` |
  | `next dev` | `vp dev` |
  | ESLint + Prettier | `vp check` (Oxlint + Oxfmt + type-check) |
  | Jest | `vp test` (Vitest) |
  | App Router `app/` | TanStack `src/routes/` |
  | Server actions | server functions |

- Show the speed: time the cold `vp dev` start and a `vp check` run.
- CI segment: the Actions tab, a cached second run, a failing check blocking a PR.
- Workflow segment: slice PR → preview URL → staging → release PR → production. Explain why (safe releases, one release per episode).
- **Close on:** the live Vercel URL, the streaming test and the `s1-setup` tag. Mention why Vercel Pro: the site is built for a traffic spike.

## Exit criteria

- `vp check`, `vp test` and `vp build` pass.
- `ci` passes on GitHub; `main` and `staging` are protected.
- Production, staging and preview environments all deploy; staging and previews need a login.
- The production URL serves the home route, and `/api/stream-test` streams.
- Commit tagged `s1-setup`.
