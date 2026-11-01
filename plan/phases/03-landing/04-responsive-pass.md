# 3.4 Responsive pass, CDN caching and the first E2E tests

**Status:** in-progress (approved 31 Oct 2026)
**Phase:** 03-landing

## Goal

The landing page matches Figma at web, tablet and mobile widths. It's served from Vercel's CDN with `s-maxage` + `stale-while-revalidate`. Every preview runs a Playwright smoke test and an axe scan in a new `e2e.yml`.

## What I found (31 Oct 2026)

- **Production today:** the landing is SSR'd on every request with `Cache-Control: public, max-age=0, must-revalidate`, so the CDN never caches it (`X-Vercel-Cache: MISS`). Each response has its own CSP nonce (`src/start.ts`).
- **Prerendering clashes with the nonce CSP.** A throwaway build with TanStack Start's `prerender` turned on for `/` wrote `.output/public/index.html` with **one nonce baked into all 17 tags**. That file is served as a static file, so the CSP middleware never runs and the page goes out **with no CSP at all**. Making a prerendered page strict again means switching it to a hash-based CSP, computed after the build from the inline scripts. That's doable but fiddly, and it breaks whenever TanStack changes its inline scripts. See decision 1.
- **Route headers:** TanStack routes take a `headers()` option, and Start merges it into the HTML response. That's where `publicCacheHeaders()` goes.
- **Previews and staging** answer anonymous requests with a `302` to Vercel login. `VERCEL_AUTOMATION_BYPASS_SECRET` already exists (1.5) and gets a `200`.
- **Carried over from 3.3:** "a sticky mobile 'Get a quote' bar and fine responsive tuning (3.4)".

## Decisions for you

1. **CDN-cached SSR instead of prerendering (recommended).** The landing stays SSR, and its route sends `publicCacheHeaders()` (`s-maxage=300, stale-while-revalidate=600`). Vercel's CDN then caches the HTML **together with its CSP header**, so the function runs about once every 5 minutes per region, not once per visitor. That's the same speed and cost win as prerendering, and the CSP stays.
   - **The cost:** visitors inside one cache window share a nonce. A nonce only protects against injected markup, and the landing has no user content to inject into, so this is low risk. The rule (engineering.md §9) is that **pages with user content never get a public cache**; those stay `private, no-store` (§5 already says this for account, quote and Kerbie).
   - **The alternative** is prerender + a hash-based CSP, built after the build (see above). Pick this one if you want the word "prerendered" to hold literally, and accept the extra moving part.
   - Either way I'll update engineering.md §5 ("Rendering"), §13 ("stays prerendered") and the 3.4 slice title to say what we actually do.
2. **`e2e` is not a required check yet.** `deployment_status` runs attach to the commit, not reliably to the PR, and a Vercel hiccup would block merges. It shows on the PR's commit, and we read it before merging. We can revisit once it's been stable for a phase.
3. **Sticky mobile "Get a quote" bar: dropped.** The landing already has several "Get a quote" buttons, and a pinned bar would cover part of small screens and clash with the 3.5 consent banner. This closes the 3.3 note.

Answered 31 Oct 2026: 1 as recommended (CDN-cached SSR), 2 as recommended (not required), 3 dropped.

Raised during the build (31 Oct 2026):

4. **E2E trigger: `repository_dispatch`, not `deployment_status`.** The repo has no GitHub Deployments: Vercel only posts commit statuses, because the project's `deployment_status` events are off. Vercel now recommends its `repository_dispatch` events (`vercel.deployment.success`, with the deploy `url`, `environment` and `git.sha` in `client_payload`). **GitHub only runs that trigger, and the manual `workflow_dispatch` one, from the copy of `e2e.yml` on `main`**, so the workflow starts running with the Phase 3 release. Until then the suite runs locally against the preview with the bypass header. Answered: `repository_dispatch`.
5. **Page background: keep the cream `--bg-page`.** Figma's landing frame is white below the hero; the site uses the design system's cream page background with white bands for the accordion and quick actions. Answered: keep cream.

## Figma vs live (31 Oct 2026)

Compared Figma web `53:1936` (1440), tablet `88:2254` (1024) and mobile `88:2528` (390) with the dev build, plus a sweep at 320, 600, 768, 900 and 1200 px.

| Width | Section | Difference | Result |
|---|---|---|---|
| all | Page | Cream page background where Figma is white | Kept (decision 5) |
| all | Header, hero, accordion, footer | Demo banner, excess callout, Business item and footer link, new copy | Earlier decisions; not differences |
| 1024 | Accordion, quick actions | 64 px band padding; Figma tablet has 32 | Fixed: 32 px from 768 to 1199 |
| 1024 | Trust strip | "Reviews coming soon" wrapped to two lines | Fixed: value scales `clamp(26px, 2.9vw, 36px)` on tablet; fits one line at 1024 |
| 768–1023 | Trust strip | The long value still wraps, and pushed its caption out of line | Fixed: subgrid rows keep all three captions level |
| 320 | Hero form | Postcode field squeezed to 12 px | Fixed: the field and button stack when the form card is narrow (container query) |
| 768–800 | Hero form | Postcode field 64 px in the two-column hero | Fixed by the same container query |
| all | Footer | Demo line contrast 4.1:1 (axe, serious) | Fixed: `--stone-600` |

After the fixes, the tablet page is 2856 px tall against Figma's 2743 + 34 (banner) + 76 (Business row) = 2853. Web and mobile were already within a few pixels. There's no horizontal scroll from 320 px up. The small buttons (36 px "sm" and the 32 px bell) keep the design system's sizes; they pass WCAG 2.2 AA's 24 px target size.

## In scope

### Responsive pass

- Screenshot Figma web `53:1936`, tablet `88:2254` and mobile `88:2528`, and the live page at 1440, 1024/768 and 390 px. List every visible difference in this file (section, width, what's off), then fix them in `landing.css` and the chrome CSS. I'll say before running the headless browser.
- Check the widths between frames (320, 600, 900, 1200 px) for overflow, cramped tap targets (< 44 px), wrapped buttons and orphaned headings.
- No horizontal scroll at any width from 320 px up; this is checked in E2E too.

### CDN caching (decision 1)

- `src/routes/_site/index.tsx` gets `headers: () => publicCacheHeaders()`. `src/server/cache.ts` reads `env` and must stay out of the client bundle, so the call goes through a server-only wrapper (`createServerOnlyFn`) if TanStack's import protection complains.
- Only the landing route gets it. The 404 page and `/system` keep the default.
- Check on the preview: the first request gets `X-Vercel-Cache: MISS` and the second gets `HIT`. The CSP header and the HTML nonces match on a cached response.

### E2E (`e2e.yml`)

- **Tooling:** `@playwright/test` and `@axe-core/playwright` as dev deps. The `playwright` package is already installed for Vitest browser mode, so they're pinned to the same version. Config in `playwright.config.ts`: Chromium only, `baseURL` from `BASE_URL`, and the bypass header `x-vercel-protection-bypass` sent as an extra HTTP header when `VERCEL_AUTOMATION_BYPASS_SECRET` is set. Specs live in `e2e/`.
- **`e2e/smoke.spec.ts`:**
  - `/` returns 200.
  - `Cache-Control` contains `s-maxage` and `stale-while-revalidate`.
  - The `h1` is "Kerb Online Insurance.".
  - Submitting "e83rl" in the hero lands on `/quote?postcode=E8+3RL`.
  - "Continue a saved quote" points at `/quote/retrieve`.
  - The accordion's car link points at `/quote?type=car`.
  - `/quote` currently returns the site 404 ("This page isn't built yet"). That test is marked to flip when Phase 5 lands (phase decision: check paths, not 200s).
  - No horizontal scroll at 320, 390, 768 and 1440 px.
  - No console errors and no `securitypolicyviolation` events while the page loads.
- **`e2e/a11y.spec.ts`:** axe on `/` at 390 and 1440 px, which fails on `serious` or `critical`. Pages join the list as they ship.
- **`.github/workflows/e2e.yml`:**
  - Trigger: `repository_dispatch` `vercel.deployment.success` when `client_payload.environment` isn't `production`, plus `workflow_dispatch` with a `url` input (decision 4).
  - Steps: check out at the deployed SHA (`client_payload.git.sha`), `setup-vp`, Chromium cached the same way as `ci.yml`, then `vp exec playwright test` with `BASE_URL` set to the deployment's URL.
  - On failure, upload the Playwright report as an artifact.
  - Permissions: `contents: read`.
- `vp test` doesn't pick up `e2e/` (its projects only include `src/**`), and `vp check` lints and type-checks it.

### Housekeeping

- Mark 3.3 done in `phase.md` and `build-plan.md`. It landed as #33, plus the scope follow-up #34.

## Out of scope

- PostHog (3.5).
- Lighthouse CI and performance budgets (8.7). Lighthouse stays a manual check here.
- Quote, claim and auth journeys in E2E (5.6, 6.10).
- New sections or copy changes beyond what the Figma comparison turns up.

## Sources

- Figma `Landing page – Web` `53:1920`: web `53:1936`, tablet `88:2254`, mobile `88:2528`.
- [engineering.md](../../engineering.md) §4 (e2e.yml, axe), §5 (CDN caching, `PUBLIC_CACHE_SECONDS`), §9 (CSP).
- `src/server/cache.ts`, `src/start.ts`, `.github/workflows/ci.yml` (setup-vp and Chromium cache steps to copy), [01-setup/05-deploy-environments.md](../01-setup/05-deploy-environments.md) (bypass secret).

## Files

- New:
  - `plan/phases/03-landing/04-responsive-pass.md` (this file)
  - `playwright.config.ts`
  - `e2e/smoke.spec.ts`, `e2e/a11y.spec.ts`
  - `.github/workflows/e2e.yml`
- Changed:
  - `src/routes/_site/index.tsx`
  - `src/features/landing/landing.css` and chrome CSS, as the comparison requires
  - `package.json` and `pnpm-lock.yaml`
  - `.gitignore` (Playwright output)
  - `src/components/site/site.css` (footer demo line contrast)
  - `plan/engineering.md` §5, §9 and §13
  - `plan/phases/03-landing/phase.md`
  - `plan/build-plan.md`

## Steps

- [x] Figma vs live comparison, with the difference list written here.
- [x] Fix the differences, then sweep the in-between widths.
- [x] Landing route headers; checked on `vp preview` (header present, CSP nonce matches the HTML, 404 and `/system` unchanged). The CDN `HIT` check waits for the preview.
- [x] Playwright config, smoke and a11y specs: 9/9 pass locally against `vp build && vp preview`. Against the preview: after the push.
- [x] `e2e.yml`.
- [x] Doc updates (engineering.md §4, §5, §9, §13; phase.md).
- [x] `vp check`, `vp test` (147), `vp build`.

## Your steps (Damion)

1. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**: name `VERCEL_AUTOMATION_BYPASS_SECRET`, value from `.env.local`. Without it, `e2e.yml` gets the `302` login page and fails.
2. After the PR's preview deploys, I run the suite against it locally with the bypass header and check `X-Vercel-Cache` MISS then HIT, and Lighthouse. The **e2e** workflow itself first runs after the Phase 3 release puts `e2e.yml` on `main` (decision 4).

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | `cache.test.ts` stays as is: header format and `PUBLIC_CACHE_SECONDS` | yes |
| E2E | Smoke: 200; `s-maxage` + `stale-while-revalidate`; hero submit → `/quote?postcode=E8+3RL`; "Continue a saved quote" → `/quote/retrieve`; car → `/quote?type=car`; no horizontal scroll at 320/390/768/1440; no console errors or CSP violations | yes (in `e2e.yml`) |
| E2E (axe) | `/` at 390 and 1440 px: no `serious` or `critical` violations | yes (in `e2e.yml`) |
| Component | none new: the 3.3 tests cover the parts; CSS fixes are checked visually | — |
| Manual | Figma side by side at web, tablet and mobile (recorded); Lighthouse accessibility ≥ 95 on the preview; `X-Vercel-Cache` MISS then HIT on the preview | yes |

## Done when

- [ ] No differences left on the Figma list, or each remaining one is noted as a decision.
- [ ] The preview's landing sends `s-maxage` + `stale-while-revalidate`, and a second request is a CDN `HIT`.
- [ ] The E2E suite (smoke + axe) passes against this PR's preview; `e2e.yml` itself runs from the release on (decision 4).
- [ ] Lighthouse accessibility ≥ 95 on the preview.
- [ ] `vp check`, `vp test` and `vp build` pass locally and in `ci`.

## Commit message

`feat: landing responsive pass, CDN caching and Playwright smoke + axe tests on previews`
