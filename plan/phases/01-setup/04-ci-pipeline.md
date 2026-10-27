# 1.4 CI pipeline

**Status:** spec
**Phase:** 01-setup

## Goal

Every push and PR runs `vp check`, `vp test` and `vp build` on GitHub Actions, with dependency and task caching, so broken code can't reach `staging` or `main`.

## In scope

- `.github/workflows/ci.yml` at the repo root (`kerb-online-insurance/` is the repo, so no subfolder handling).
- Triggers: `pull_request` to `staging` and `main`, `push` to `staging` and `main`. Ignore changes that only touch `plan/**`.
- `voidzero-dev/setup-vp`, pinned to an exact release (commit SHA + tag comment), with `node-version: '24'` and `cache: true`.
- Job name `ci`. It becomes the required check in 1.6.
- `concurrency` group per branch, so a new push cancels the older run.
- `pnpm audit --prod` step (fails on high/critical).
- Damion turns on GitHub secret scanning + push protection and Dependabot security alerts (repo settings).
- `.github/dependabot.yml`: weekly, grouped, targeting `staging` (the branch exists after 1.6; until then Dependabot falls back to the default branch).

## Out of scope

- Migration drift check (added in 4.1), e2e (3.4), Lighthouse (8.7), Kerbie eval (7.6).
- Branch protection (1.6).
- Vite Task cache across runs. It only caches `vp run` tasks (not direct `vp check`/`vp build`), is marked experimental, and our build takes under a second, so restore/save would cost more than it saves. Revisit if CI gets slow.

## Sources

- [engineering.md §4](../../engineering.md#4-ci-github-actions)
- https://viteplus.dev/guide/ci (setup-vp inputs; the separate Vite Task cache)
- setup-vp releases: https://github.com/voidzero-dev/setup-vp/releases

## Files

- `.github/workflows/ci.yml`, `.github/dependabot.yml`

## Steps

- [x] Look up the current setup-vp release (v1.22.0) and pin it.
- [x] Write `ci.yml`: checkout → setup-vp → `vp check` → `vp test` → `vp build` → `pnpm audit`.
- [x] Write `dependabot.yml`.
- [ ] Push to `main` (bootstrap) and watch the run in the Actions tab.
- [ ] Push again with no changes and confirm the second run is faster (cache hits).

## Done when

- [ ] The `ci` job passes on GitHub for the latest `main` commit.
- [ ] The second run shows the dependency cache restored and a shorter duration.
- [ ] A deliberately broken format (in a throwaway branch) makes `ci` fail.

## Commit message

`ci: GitHub Actions check/test/build with Vite+ caching`
