# Kerb: build plan

Tick a slice when its PR is merged into `staging`. When a phase's last slice lands, release `staging → main` and tag it. See [engineering.md](engineering.md).

## 1. Setup · `s1-setup` · [phase](phases/01-setup/phase.md)

- [x] 1.1 **Vite+ check**: `vp` on PATH, tour of the commands
- [x] 1.2 **Scaffold TanStack Start**: `vp create`, strip the demo
- [x] 1.3 **Conventions**: folders, aliases, env handling, pre-commit hook, cache helper, `vp check` clean
- [x] 1.4 **CI pipeline**: GitHub Actions (`setup-vp`, check/test/build, caching), Dependabot, `pnpm audit`, secret scanning
- [x] 1.5 **Deploy environments**: Vercel production (`main`), staging (`staging`), PR previews; London region; protection, spend limit, firewall (incl. server-function path); security headers; streaming test
- [x] 1.6 **Git workflow + first release**: `staging` branch, branch protection, PR template, release PR → tag `s1-setup`

## 2. Design system · `s2-design-system` · [phase](phases/02-design-system/phase.md)

- [x] 2.1 **Tokens and fonts**
- [x] 2.2 **Display and action components** → TSX
- [x] 2.3 **Form components** → TSX
- [x] 2.4a **Feedback components** → TSX (Alert, Dialog on native `<dialog>`, Toast + Toaster, Tooltip)
- [x] 2.4b **Navigation and insurance components** → TSX (Tabs, Stepper, CoverageOption + CoverageGroup, Timeline)
- [ ] 2.5 **`/system` page**

## 3. Landing · `s3-landing` · [phase](phases/03-landing/phase.md)

- [x] 3.1 **Site chrome**: header and footer, plus a "Kerb is a demo" banner and footer line
- [x] 3.2 **Split hero**, with a "Retrieve my quote" link
- [x] 3.3 **Landing parts**: insurance types accordion, steps, trust stats (clearly illustrative, no fake review or FCA numbers), excess callout, quick actions
- [x] 3.4 **Responsive pass** against Figma
- [ ] 3.5 **PostHog + first experiment**: wizard install, then `/ingest` proxy, EU host, lazy load, cookieless until consent; hero-CTA A/B test

## 4. Data and auth · `s4-data-auth` · [phase](phases/04-data-auth/phase.md)

- [ ] 4.1 **Neon + Drizzle setup**: London, `prod` + `dev` branches, migration scripts, migrate in the Vercel build (staging/prod), CI drift check; unit/integration test split with a Postgres test DB in CI
- [ ] 4.2 **Schema + first migration**: multi-product (car, home, business), bundles, auth tables; integrity constraints, money in pence, `version` columns
- [ ] 4.3 **Auth screens designed in Figma**: incl. Google button and 2FA screens
- [ ] 4.4 **Better Auth**: sign up (with a demo notice, Turnstile), email + password (breached-password check), Google sign-in, soft email verification (banner, not a blocker), sessions, rate limits
- [ ] 4.5 **Authorization layer**: roles (customer, claims handler, admin), server middleware, scoped data access, audit log, make-admin script, permission tests; plus `withTx`, `withIdempotency`, shared rate limiter
- [ ] 4.6 **2FA**: optional for customers, required for staff; sign out everywhere
- [ ] 4.7 **Privacy page + delete account**
- [ ] 4.8 **Reference data**: vehicle catalogue (make → model → year → variant) and rating tables v1
- [ ] 4.9 **Seed script** (synthetic, idempotent, all three products and bundles)
- [ ] 4.10 **Upload foundation**: R2 buckets `kerb-dev`/`kerb-prod`, `files` table, direct-to-R2 signed uploads, image resize + EXIF strip, cleanup cron
- [ ] 4.11 **Background jobs**: `jobs` table (outbox), `waitUntil` runner, per-minute Cron retries with backoff, dead-job view; upload cleanup moves onto it

## 5. Quote · `s5-quote` · [phase](phases/05-quote/phase.md)

- [ ] 5.1 **Quote start + flow shell + Stepper**: `/quote` takes `?postcode` and `?type`, asks for whichever is missing; car and home continue, other types show "coming soon"
- [ ] 5.2 **Vehicle step**: make → model → year → variant picker, faked plate lookup
- [ ] 5.3 **Driving habits + driver steps**
- [ ] 5.4 **Rating engine** `priceQuote()`: table-driven, versioned, all three products + bundle discount, with tests
- [ ] 5.5 **Cover options + summary**: cover comparison table, price breakdown
- [ ] 5.6 **Pay → policy saved** (sign-in gate keeps the quote); "Retrieve my quote" lists a signed-in user's saved quotes; quote → policy Playwright journey
- [ ] 5.7 **Home steps**: property → contents and security → past claims, then the shared cover, summary and pay; home quote → policy Playwright journey

## 6. Account and claims · `s6-account-claims` · [phase](phases/06-account-claims/phase.md)

- [ ] 6.1 **Dashboard**
- [ ] 6.2 **Policy detail**, with downloadable documents (certificate of insurance, policy schedule)
- [ ] 6.3 **Settings**: address, drivers, 2FA on/off, sign out everywhere
- [ ] 6.4 **Claims overview + incident step**
- [ ] 6.5 **Damage + review + submit**: damage photos and claim documents (PDF)
- [ ] 6.6 **Claim tracker** (shows `claim_events` written by staff in 6.10)
- [ ] 6.7 **Reviews: write**: review UI designed in Figma; `reviews` table; up to 3 photos; "Leave a review" card on the dashboard for policyholders
- [ ] 6.8 **Admin area**: review moderation queue (approve / reject) + `/admin/users` role assignment (audited)
- [ ] 6.9 **Reviews: public**: `/reviews` page (average, filters) + latest reviews in the landing trust section; `/media/r/:fileId` photo route
- [ ] 6.10 **Staff claims console**: designed in Figma first; `/staff/claims` queue + claim detail (photos, documents, notes); status changes write `claim_events`; claim → approval Playwright journey

## 7. Kerbie · `s7-kerbie` · [phase](phases/07-kerbie/phase.md)

- [ ] 7.1 **Kerbie UI designed in Figma**: bottom-right launcher, glyph avatar (no mascot), says it's an AI, hands off to "contact us"
- [ ] 7.2 **Chat route + panel, guest mode**
- [ ] 7.3 **Storage, usage logging, limits and spend cap**
- [ ] 7.4 **Read tools** for signed-in users (including `getMyDocuments`), plus `getReviewSummary` for everyone
- [ ] 7.5 **Action tools + confirm cards + audit**
- [ ] 7.6 **Model comparison per task** → defaults chosen
- [ ] 7.7 **Review auto-check**: AI screens new reviews and their photos; clean ones publish, flagged or uncertain ones go to the queue
- [ ] 7.8 **Photos to Kerbie**: attach button, AI vision, "start a claim with this photo" action, eval cases

## 8. Launch · `s8-launch` · [phase](phases/08-launch/phase.md)

- [ ] 8.1 **Error, empty and loading states**
- [ ] 8.2 **Accessibility pass**
- [ ] 8.3 **Meta, OG image, favicon** (favicon already added in 1.3; maybe an SVG version)
- [ ] 8.4 **Final deploy + link in the UI/UX video description**
- [ ] 8.5 **Website video script + shot list**
- [ ] 8.6 **Launch readiness**: check current service limits, upgrade where needed, spend caps and alerts everywhere, load test (decides on Redis)
- [ ] 8.7 **Performance budgets in CI**: Lighthouse CI on previews, Speed Insights on production
- [ ] 8.8 **Backups, restore drill and runbook**: nightly `pg_dump` to the `kerb-backups` R2 bucket (14 days), restore drill into a Neon branch, `plan/runbook.md`
- [ ] 8.9 **Security review**: OWASP-style checklist, headers scan, dependency audit, secret-rotation dry run, permission tests green

## Later (not scheduled)

- [ ] **More quote journeys**: business (tables, rating and seed data already exist from 4.2, 4.8 and 4.9), then condo, tenant, landlord and pet (each needs a detail table, rating factors and seed data). Until then, `/quote` shows them as "coming soon" (decided 31 Oct 2026).
