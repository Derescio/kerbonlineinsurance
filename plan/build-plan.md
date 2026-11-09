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
- [x] 2.5 **`/system` page**

## 3. Landing · `s3-landing` · [phase](phases/03-landing/phase.md)

- [x] 3.1 **Site chrome**: header and footer, plus a "Kerb is a demo" banner and footer line
- [x] 3.2 **Split hero**, with a "Retrieve my quote" link
- [x] 3.3 **Landing parts**: insurance types accordion, steps, trust stats (clearly illustrative, no fake review or FCA numbers), excess callout, quick actions
- [x] 3.4 **Responsive pass** against Figma
- [x] 3.5 **PostHog + first experiment**: wizard install, then `/ingest` proxy, lazy load (US region kept); hero-CTA A/B test
- [x] 3.6 **Consent banner**: PostHog cookieless until accepted, cookie choice bar, footer "Cookie settings"

## 4. Data and auth · `s4-data-auth` · [phase](phases/04-data-auth/phase.md)

- [x] 4.1 **Neon + Drizzle setup**: London, `prod` + `dev` branches, migration scripts, migrate in the Vercel build (staging/prod), CI drift check; unit/integration test split with a Postgres test DB in CI
- [x] 4.2 **Schema + first migration**: multi-product (car, home, business), bundles, auth tables, underwriting outcomes and rating versions, audit log; data-ready (tombstones, factor rows, funnel events, data contract test); integrity constraints, money in pence, `version` columns
- [x] 4.3 **Auth screens designed in Figma**: incl. Google button and 2FA screens
- [x] 4.4 **Better Auth**: sign up (with a demo notice, Turnstile), email + password (breached-password check), Google sign-in, soft email verification (banner, not a blocker), sessions, rate limits, security events
- [x] 4.4b **Hard email verification**: confirm before logging in, 6-hour links, no account enumeration on sign-up
- [x] 4.5 **Authorization layer**: permissions instead of role names, several roles per staff member, server middleware, scoped customer and staff reads, conflict-of-interest rule, make-admin script, permission suite
- [x] 4.5b **Audit integrity and database security**: HMAC-chained `audit()` and `verifyAuditChain()` with versioned keys, `claim.viewed` / `referral.viewed` / `staff.added`, non-owner app role `kerb_app`, `db:check-app-role` (merged as #56)
- [x] 4.5c **Safe write tools**: `withTx`, `withIdempotency`, shared `limit()` rate limiter, validation-error contract, `defineWrite`, form helpers (merged as #58)
- [x] 4.6 **2FA**: optional for customers, required for staff; the Google challenge, fresh-session checks, sign out everywhere, a typed list of audit actions (merged as #59)
- [x] 4.7 **Privacy page + account closure**: `/privacy` and `/cookies`; immediate delete for an account with nothing on file; a 30-day closure (daily cron, held while a claim is open) that keeps insurance records and audit history (merged as #61)
- [x] 4.8 **Reference data**: vehicle catalogue (43 UK models, make → model → year → variant) and rating tables v1 for car, home and business, calibrated to 2026 market prices, loaded on every deploy (merged as #65)
- [x] 4.9 **Seed script** (synthetic, idempotent, all three products and bundles; 12 months backdated; every data-contract table filled)
- [x] 4.10 **Upload foundation**: R2 buckets `kerb-dev`/`kerb-prod`, `files` table, direct-to-R2 signed uploads, image resize + EXIF strip, cleanup cron
- [x] 4.11 **Background jobs**: `jobs` table (outbox), `waitUntil` runner, 6-hourly Cron retries with backoff, one daily cron (dead-job view moves to Phase 6); emails and upload cleanup move onto it; anchors the audit chain's latest hash in R2 daily

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
- [ ] 6.3 **Settings**: address, drivers, 2FA on/off, sign out everywhere, recent activity; `policy_versions` history
- [ ] 6.4 **Claims overview + incident step**
- [ ] 6.5 **Damage + review + submit**: damage photos and claim documents (PDF)
- [ ] 6.6 **Claim tracker** (shows `claim_events` written by staff in 6.10), settlement card, messages, notification bell
- [ ] 6.7 **Reviews: write**: review UI designed in Figma; uses the `reviews` table from 4.2; up to 3 photos; "Leave a review" card on the dashboard for policyholders
- [ ] 6.8 **Admin area**: review moderation queue (approve / reject) + `/admin/users` role assignment and staff deactivation (audited) + `/admin/audit` viewer with chain check
- [ ] 6.9 **Reviews: public**: `/reviews` page (average, filters) + latest reviews in the landing trust section; `/media/r/:fileId` photo route
- [ ] 6.10 **Staff claims console**: designed in Figma first; `/staff/claims` queue + claim detail (photos, documents, notes); status changes write `claim_events`; staff views of claims and files audited; claim → approval Playwright journey
- [ ] 6.11 **Staff referral queue**: designed in Figma first; `/staff/referrals` for quote items the eligibility rules referred; approve (with optional loading) or decline, audited; referral → approval → purchase Playwright journey

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
- [ ] 8.9 **Security review**: OWASP-style checklist, headers scan, dependency audit, secret-rotation dry run, permission tests green, audit chain verifies on `prod`; decide on a separate Postgres role without `UPDATE`/`DELETE` on the audit tables (optional)

## 9. Data platform · `s9-data` · [phase](phases/09-data/phase.md)

Placeholder (added 2 Nov 2026); specced when the phase starts. Feeds the data video.

- [ ] 9.1 **`analytics` views + read-only pipeline role** (from the data contract)
- [ ] 9.2 **Azure foundation**: ADLS Gen2, Key Vault, budget alerts, infrastructure as code
- [ ] 9.3 **Ingestion**: incremental watermark copies + `deleted_rows` into bronze
- [ ] 9.4 **Databricks + Unity Catalog**: bronze → silver, deletes applied
- [ ] 9.5 **Gold models**: funnel, conversion, pricing factors, underwriting, claims, reviews
- [ ] 9.6 **PostHog events joined**
- [ ] 9.7 **Data quality + erasure test**
- [ ] 9.8 **Dashboards** for the data video

## Later (not scheduled)

- [ ] **More quote journeys**: business (tables, rating and seed data already exist from 4.2, 4.8 and 4.9), then condo, tenant, landlord and pet (each needs a detail table, rating factors and seed data). Until then, `/quote` shows them as "coming soon" (decided 31 Oct 2026).
