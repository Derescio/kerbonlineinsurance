# 1.5 Deploy environments

**Status:** spec
**Phase:** 01-setup

## Goal

The app is live on Vercel in three environments: production from `main`, staging from `staging`, and a preview for every PR. Streaming works, and the non-production environments are private.

## In scope

- Nitro deployment for TanStack Start (the route TanStack's hosting guide gives for Vercel), Vercel preset.
- A Vercel project linked to `Derescio/kerbonlineinsurance` (Root Directory is the repo root, the default).
  - **Production** = `main`.
  - **Staging** = a Pro custom environment tracking `staging`, with a stable URL: the branch alias `<project>-git-staging-<team>.vercel.app`, or a free `*.vercel.app` alias if the name is available.
  - **Preview** = every PR.
- **Function region London (`lhr1`)**, to sit next to Neon later (4.1).
- **Deployment Protection:** Vercel Authentication on Staging and Preview, so the public only sees production. Create a protection-bypass secret for automation (used by e2e in 3.4).
- **Spend Management:** a monthly spend limit and alerts on the Pro team.
- **Vercel Firewall:** on, with starter rate-limit rules on `/api/*` **and the TanStack server-function path** (it isn't under `/api`; confirm the prefix from the build output). See [engineering.md §10](../../engineering.md#10-rate-limiting).
- **Security headers:** CSP, HSTS, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, `nosniff`. See [engineering.md §9](../../engineering.md#9-security).
- Streaming test route `src/routes/api/stream-test.ts`, about 10 words with a short delay between them.
- Check that hashed static assets are served with `Cache-Control: public, max-age=31536000, immutable`.

## Out of scope

- Custom domain (decided: none).
- Secrets for the DB, auth or AI (added in their phases).

## Sources

- [engineering.md §2 and §5](../../engineering.md#2-vercel-environments-no-custom-domain)
- TanStack Start hosting guide: https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- Vercel docs: custom environments, Deployment Protection, Spend Management, Firewall rate limiting, function regions.

## Files

- `vite.config.ts` (Nitro plugin)
- `src/routes/api/stream-test.ts`
- `vercel.json` (region, and anything the defaults don't cover)

## Steps

- [ ] Add Nitro per the TanStack guide (check the current package and config first). `vp build` locally and check the output.
- [ ] Add the streaming route. Check it locally with `curl -N`: the words should arrive one by one.
- [ ] Set the region to `lhr1` in `vercel.json`.
- [ ] **Damion, in the Vercel dashboard:**
  - [ ] Import the repo (leave Root Directory as the default).
  - [ ] Create the Staging custom environment tracking `staging`.
  - [ ] Turn on Vercel Authentication for Staging and Preview.
  - [ ] Set the spend limit and alerts.
  - [ ] Turn on the Firewall rule.
- [ ] Check production: the home page, `curl -N …/api/stream-test`, and the asset cache headers (`curl -I`).
- [ ] Write the production and staging URLs into `project-plan.md` under Deployment.

## Done when

- [ ] The production URL shows "Kerb", and `/api/stream-test` streams word by word.
- [ ] Response headers show the function ran in `lhr1`, and assets are `immutable`.
- [ ] Security headers are present (`curl -I`), and the page still loads with the CSP on (no console CSP errors).
- [ ] Opening a preview URL in a private window asks for a Vercel login.
- [ ] A spend limit, alerts and the firewall rule are set.
- [ ] `vp check`, `vp test`, `vp build` and `ci` pass.

## Commit message

`feat: Vercel deploy via Nitro (London), streaming test endpoint`
