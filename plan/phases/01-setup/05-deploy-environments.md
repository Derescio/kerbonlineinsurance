# 1.5 Deploy environments

**Status:** done (staging URL goes live with the `staging` branch in 1.6)
**Phase:** 01-setup

## Goal

The app is live on Vercel in three environments: production from `main`, staging from `staging`, and a preview for every PR. Streaming works, and the non-production environments are private.

## In scope

- Nitro deployment for TanStack Start (the route TanStack's hosting guide gives for Vercel), Vercel preset.
- A Vercel project linked to `Derescio/kerbonlineinsurance` (Root Directory is the repo root, the default).
  - **Production** = `main`.
  - **Staging** = a Pro custom environment tracking `staging`, with a stable URL: `kerbonlineinsurance-staging.vercel.app`.
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

- `vite.config.ts` (Nitro plugin, region, static security headers)
- `src/routes/api/stream-test.ts`
- `src/server/security-headers.ts` (+ test), `src/start.ts` (per-request CSP nonce), `src/router.tsx` (passes the nonce to the router)
- No `vercel.json`: Nitro writes the Vercel Build Output API files, and Vercel can ignore `vercel.json` routing for those. The region and headers live in Nitro's `vercel` config instead, so they land in `.vc-config.json` and `config.json`.

## Steps

- [x] Add Nitro per the TanStack guide (check the current package and config first). `vp build` locally and check the output.
- [x] Add the streaming route. Check it locally with `curl -N`: the words should arrive one by one.
- [x] Set the region to `lhr1` (in Nitro's `vercel.functions.regions`, not `vercel.json`).
- [x] Security headers: static set on every response via a Vercel route with `continue: true`; CSP with a per-request nonce from request middleware.
- [x] **Damion, in the Vercel dashboard:**
  - [x] Import the repo (leave Root Directory as the default).
  - [x] Create the Staging custom environment tracking `staging`.
  - [x] Turn on Vercel Authentication for Staging and Preview.
  - [x] Set the spend limit and alerts.
  - [x] Turn on the Firewall rule.
- [x] Check production: the home page, `curl -N …/api/stream-test`, and the asset cache headers (`curl -I`).
- [x] Write the production and staging URLs into `project-plan.md` under Deployment.

## Notes from the build

- **Nitro** `nitro@3.0.260903-beta`, pinned exactly. v3 only ships as a beta, and `latest` points at it.
- **Vercel output** (`NITRO_PRESET=vercel vp build`): one function `__server.func` with `supportsResponseStreaming: true`, `regions: ["lhr1"]`, `nodejs24.x`. `/assets/*` gets `public, max-age=31536000, immutable`.
- **Server-function prefix:** `/_serverFn/` (`SERVER_FN_BASE` in the SSR bundle). The firewall rate-limit rule covers `/api/*` and `/_serverFn/*`.
- **Local stream check:** 10 words, about 300 ms apart.
- **CSP:** `script-src 'self' 'nonce-…'`, no `unsafe-inline`. Every script and link TanStack renders carries the nonce. The CSP header is off under `vp dev` because Vite injects its own inline scripts.
- **Verified on production:** `x-vercel-id: …::lhr1::…`; all security headers present; `/assets/*` `immutable`; stream 10 words about 300 ms apart; all 4 scripts carry the header's nonce. The preview gives an anonymous `302` to Vercel SSO and `200` with `x-vercel-protection-bypass`.
- **Firewall:** `rate-limit-api` (`/api/`) and `rate-limit-server-functions` (`/_serverFn/`), fixed window, 100 requests per 60 s per IP, then 429. Tested on production: 115 requests to `/api/rate-limit-probe` gave 404 ×100, then 429 from request 101. Tune in 8.6.
- **Staging URL:** `kerbonlineinsurance-staging.vercel.app`, assigned to the Staging environment in Domains. A nested name like `staging.kerbonlineinsurance.vercel.app` fails TLS, because the `*.vercel.app` certificate covers only one level.
- **Bypass secret:** `VERCEL_AUTOMATION_BYPASS_SECRET` in `.env.local`, placeholder in `.env.example`.
- **Follow-up for 3.4:** once landing is CDN-cached (`s-maxage`), cached HTML reuses one nonce until it expires. That's acceptable for a page with no user content, but see Vercel's "CSP nonces with CDN cache" guide when 3.4 lands.

## Done when

- [x] The production URL shows "Kerb", and `/api/stream-test` streams word by word.
- [x] Response headers show the function ran in `lhr1`, and assets are `immutable`.
- [x] Security headers are present (`curl -I`), and the page still loads with the CSP on (no console CSP errors).
- [x] Opening a preview URL in a private window asks for a Vercel login.
- [x] A spend limit, alerts and the firewall rule are set.
- [x] `vp check`, `vp test`, `vp build` and `ci` pass.

## Commit message

`feat: Vercel deploy via Nitro (London), streaming test endpoint`
