# Kerb: project plan

## Problem

Kerb is a fictional UK digital car insurer, designed from a real Upwork brief for a Senior UI/UX role. The design and the design system exist in Figma and in this repo. There's no working product yet. The site has three jobs:

1. It's the live "try it yourself" demo for the **UI/UX design video**.
2. Building it is the subject of the **website creation video**: Damion records our sessions and adds voiceover.
3. Its real database feeds the **data video** (DB → Databricks/ADF).

It also has to show Opsed Solutions clients that Damion can take a product from brief to a working, deployed app.

## Users

- **Viewers trying the demo:** they land from YouTube, want to click through a quote in a minute or two, and may sign up to see the account side and Kerbie.
- **Signed-in customers (demo-real):** they have a policy, renewals and claims, and use Kerbie to ask about them or change things.
- **Claims handlers (staff):** work through claims in the staff console and move them through their statuses. Assigned by an admin; 2FA required.
- **Admin (Damion):** moderates reviews, assigns roles, and can do everything a claims handler can. 2FA required.
- **Damion:** records sessions, needs clean cut points (git tags) and a site that keeps working after the video goes live.

## Features

1. Landing page (split hero, responsive). Car and home are sold online at launch. The landing lists seven types (car, home, condo, tenant, landlord, pet, business), and each one links to the quote start with its type set; the others show "coming soon" there.
2. Quote journey: a quote start that takes a postcode and an insurance type (either can arrive from the landing, both stay editable), then the product's steps. Car: vehicle → driving habits → driver → cover → summary → pay (fake) → policy. Home: property → contents and security → past claims → cover → summary → pay (fake) → policy.
3. Real sign-up and sign-in: email + password or Google; soft email verification, password reset, optional 2FA, delete account. Roles: customer, claims handler, admin (see [engineering.md §7](engineering.md#7-authentication-and-authorization)).
4. Account: dashboard, policy detail, settings (address, drivers).
5. Claims: overview → incident → damage → review → submitted, with a tracker. Staff move claims through their statuses in a staff claims console.
6. **Kerbie**, an AI assistant:
   - **Guests:** general answers about Kerb.
   - **Signed-in users:** answers about their own policies and claims, plus actions (update address, add or remove a driver, start or submit a claim, change cover level). Each action needs a Confirm / Cancel card.

7. **Reviews:**
   - **Who:** policyholders can rate and review, one review per policy, editable. They're asked from a dashboard card.
   - **Moderation:** an AI check publishes clean reviews. Flagged ones wait in an admin queue for Damion.
   - **Where they show:** a public `/reviews` page and the landing trust section.
   - **Honesty rule:** every approved review is shown, low scores included. Only abuse and spam are removed (in the spirit of the UK DMCC Act rules on fake reviews). Reviews are labelled "Verified Kerb demo customer".
8. **Uploads** (Cloudflare R2, see [engineering.md §6](engineering.md#6-file-storage-cloudflare-r2)):
   - claim damage photos (up to 10) and claim documents (PDF, up to 5)
   - review photos (up to 3, moderated)
   - photos sent to Kerbie, which reads them with AI vision and can start a claim with them

## Data

Neon Postgres with Drizzle. **Multi-product from the start:** car, home and business, plus bundles. Car and home can be bought online at launch. Business has tables, rating factors and seed data, and its quote flow comes in a later phase. Condo, tenant, landlord and pet are listed on the landing and the quote start only; each needs a detail table, rating factors and seed data when its phase comes (decided 31 Oct 2026).

**Schema shape:** shared core tables + one detail table per product. Adding a product means adding one detail table.

- **Core tables:** users and sessions (Better Auth), vehicles, drivers, quotes, policies, claims, claim_events.
- **Reviews:** reviews (with moderation status and reason).
- **Access:** user `role`, 2FA tables, `audit_log`.
- **Platform:** `idempotency_keys`, `rate_limits`, `jobs`.
- **Files:** `files` (upload metadata only; the files themselves live in R2).
- **Kerbie and analytics:** chat_threads, chat_messages, ai_usage, kerbie_actions, events (server-side funnel milestones for the data video; product analytics and A/B tests are in PostHog).
- A seed script adds about 12 months of synthetic history, flagged `is_synthetic`, for the data video.

## Pricing

A table-driven, versioned **rating engine**, a simplified version of what real insurers use:

`premium = base rate (product, cover level) × rating factors + fees + Insurance Premium Tax (12%)`, minus a bundle discount when a quote has more than one product.

| Product | Rating factors |
|---|---|
| Car | insurance group (1–50), vehicle value and age, driver age, years licensed, no-claims years, postcode risk band, annual mileage, usage, voluntary excess, past claims |
| Home | rebuild cost, contents value, property type and age, postcode flood/crime band, security, past claims |
| Business | trade class, turnover, employees, cover sections chosen |

- **Rating tables** live in the DB with a version number. Every quote stores its full breakdown and the rating version used.
- **Vehicles:** our own curated catalogue (about 40 popular UK models). The picker goes make → model → year → variant, and plate lookup is faked against demo plates. No paid lookup API.
- **Postcodes:** checked with postcodes.io (free, no key). The postcode area maps to our own synthetic risk bands.

## Tech

| Layer | Choice |
|---|---|
| Toolchain | Vite+ (`vp`, installed: v1.3.0, Node v24.22.0) |
| Framework | TanStack Start (React, TypeScript) |
| Styling | Kerb tokens + component CSS, copied in phase 2 from the parent design-system folder (`../tokens/`, `../components/kerb-components.css`) |
| Database | Neon Postgres + Drizzle ORM + Zod |
| Auth | Better Auth (email + password) |
| Email | Resend (free tier) |
| Bot protection | Cloudflare Turnstile (free) |
| Analytics and A/B tests | PostHog (EU cloud, free tier), through a same-origin `/ingest` proxy; cookieless until consent ([engineering.md §13](engineering.md#13-analytics-and-experiments)) |
| Background jobs | Postgres `jobs` table + Vercel `waitUntil` + per-minute Vercel Cron |
| Backups | Neon point-in-time restore + nightly `pg_dump` to an R2 `kerb-backups` bucket (14 days) |
| File storage | Cloudflare R2: private buckets `kerb-dev` / `kerb-prod`, direct browser uploads with signed URLs |
| AI | Vercel AI SDK with Anthropic and OpenAI providers, model chosen after a comparison |
| Hosting | Vercel (Damion's Pro plan), `*.vercel.app`, deployed through Nitro |

## UI/UX

- **Source of truth:**
  - Figma file `ajpEaPwbWtwbsSmRheyDAU`, page "High Fidelity Wireframes".
  - The voice and visual rules in the parent folder's `../readme.md`.
- **Need designing in Figma before building:** the Kerbie panel and confirm cards, the auth screens, and account settings.

## Deployment

See [engineering.md](engineering.md) for the full git workflow, environments, migrations, CI and caching.

| Environment | Branch | URL | DB | Access |
|---|---|---|---|---|
| Production | `main` | https://kerbonlineinsurance.vercel.app | Neon `prod` | public |
| Staging | `staging` | https://kerbonlineinsurance-staging.vercel.app (goes live once `staging` is pushed in 1.6) | Neon `dev` | Damion only (Vercel Authentication) |
| Preview | every PR | per PR, posted by Vercel on the PR | Neon `dev` | Damion only |
| Local | — | Neon `dev` | — |

Vercel Pro, repo `Derescio/kerbonlineinsurance` (this folder is the repo root), functions in London. Secrets live in Vercel env vars per environment (separate production keys) and an untracked `.env.local`.

## Capacity (planning for a big video)

Plan for a launch spike from day one. A broken or paused demo while the video is trending is the outcome to avoid.

| Service | Risk under a spike | Plan |
|---|---|---|
| **Vercel Pro** | Function and bandwidth usage beyond what Pro includes is billed. | Spend limit and alerts set in phase 1. Static assets and the landing page cached at the edge; server functions only where data is needed. |
| **Neon** | Free plan limits. | Damion's call: he creates the Neon project and supplies the connection string (phase 4), and isn't worried about the free tier. Use the pooled connection string. Upgrade only if 8.6 shows a need. |
| **Resend** | The free plan's monthly email cap (Damion's figure: 200/month) can run out during a spike. | Damion's call: hitting the cap means the promotion worked, so upgrade then. To keep the demo working meanwhile, **verification is soft**: new users can sign in and use the site straight away, with a "verify your email" banner. Only password reset needs the email. If sending fails, the user sees a friendly message instead of an error. |
| **AI (Anthropic/OpenAI)** | Every Kerbie message costs money, and a spike multiplies it. | Per-guest and per-user daily limits, a global daily spend cap with a canned fallback (phase 7), and provider-side spend limits in each console. |
| **Cloudflare R2** | Storage and operation counts grow with uploads. Egress is free. | Images are resized to at most 2048 px WebP before upload, with per-kind count limits; a cleanup cron removes abandoned and old Kerbie images. Check the current free-tier limits in 8.6, and set a Cloudflare billing alert. |
| **PostHog** | Event volume beyond the free tier during a spike. | Billing limit set in the PostHog dashboard; events sampled or autocapture trimmed if needed. Checked in 8.6. |
| **Abuse** | Bots hitting sign-up, the quote API or Kerbie. | Rate limits on sign-up, quote save and chat. Vercel Firewall/bot protection on, from the Pro dashboard. |

Check the limits in this table against each service's current pricing page in slice 8.6. Free and paid tiers change.

## Constraints

- **Hosting on Vercel Pro (already paid). Everything else starts on free tiers** (Neon, Resend), with a planned upgrade check before launch.
- **AI spend capped:** per-guest and per-user daily message limits, a global daily spend cap, and a canned fallback when the cap is hit.
- **Privacy:** real emails are collected, so the site has a privacy notice and "delete my account". No real payment. Analytics stays cookieless until the visitor consents, and the privacy notice names PostHog.
- **Permissions are enforced on the server:** every protected server function checks the role, and customer data is always looked up by the session's user id. Signing in as another user (impersonation) is switched off.
- **Writes are safe to repeat:** important actions use idempotency keys and transactions, so double-clicks and retries can't create duplicates. See [engineering.md §8–§12](engineering.md#8-data-integrity-and-idempotency) for integrity, security, rate limiting, background jobs and backups.
- **Uploads are private by default:** photos have EXIF/GPS stripped before upload, claim and Kerbie files are only reachable through short-lived signed links after an ownership check, and deleting an account deletes the user's files.
- **Data isolation:** Kerbie's tools always act as the session user. The model can never choose whose data it reads.

## Videos

| Video | What this site gives it |
|---|---|
| UI/UX design | Live demo link in the description |
| Website creation | One recording per phase; git tags `s1-setup` … `s8-launch` as cut points; script written in phase 8 |
| Data | Real and synthetic rows in Neon, chat and usage logs, funnel events |
