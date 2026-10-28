# Phase 8: Launch

**Tag:** `s8-launch` · **Status:** todo

## Goal

Polish and ship: states, accessibility, sharing metadata, final deploy, and the website video script.

## Payoff shot

The live link in the UI/UX video description, opened on a phone.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 8.1 | Error, empty and loading states | todo |
| 8.2 | Accessibility pass (including the chat panel) | todo |
| 8.3 | Meta, OG image, favicon | todo |
| 8.4 | Final deploy + link added to the UI/UX video description | todo |
| 8.5 | Website video script + shot list (format of `video-script.md`), built around the tags | todo |
| 8.6 | Launch readiness: current limits for Vercel, Neon, Resend and AI checked; upgrades done where needed; spend caps and alerts on every service; load test of landing, quote and Kerbie; the result decides whether to add Redis | todo |
| 8.7 | Performance budgets: Lighthouse CI on preview deploys (mobile LCP < 2.5 s, CLS < 0.1, landing JS < 150 KB gzip); Vercel Speed Insights on production | todo |
| 8.8 | Backups, restore drill and runbook ([engineering.md §12](../../engineering.md#12-backups-and-recovery)): nightly GitHub Action `pg_dump` of `prod` into the `kerb-backups` R2 bucket (own token, 14-day lifecycle rule, loud failure); check Neon's restore window; restore drill into a new Neon branch with a preview pointed at it (time it); write `plan/runbook.md` (site down, bad data, leaked key, AI spend spike, abuse wave) | todo |
| 8.9 | Security review ([engineering.md §9](../../engineering.md#9-security)): OWASP-style checklist, security headers scan, `pnpm audit`, secret-rotation dry run, permission tests green, CSP has no violations | todo |

## Recording notes

- Script uses the tags `s1-setup` … `s8-launch` as chapter cut points.
- End screen teases the data video.

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). This phase is mostly checks across the whole site rather than new features.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| E2E | Each error, empty and loading state renders: forced 404 and 500, empty dashboard, no claims, no reviews, slow-network skeletons | 8.1 | yes |
| E2E (axe) | Every key page, including the open Kerbie panel: zero serious or critical violations | 8.2 | yes |
| Manual | Screen reader pass (NVDA) through the quote and claim flows; keyboard-only pass of the whole site | 8.2 | yes |
| E2E | Meta tags, OG image URL and favicon return 200 with the right content type | 8.3 | yes |
| Performance | Lighthouse CI budgets on previews (mobile LCP < 2.5 s, CLS < 0.1, landing JS < 150 KB gzip) | 8.7 | yes |
| Load | Landing, quote and Kerbie (mock model) under the expected spike: no errors or pauses | 8.6 | yes |
| Recovery | Restore drill: last night's export into a new Neon branch, a preview pointed at it, sign-in and data checked | 8.8 | yes |
| Security | Permission suite green; headers scan; no CSP violations during a full E2E run (listen for `securitypolicyviolation`); `pnpm audit` clean | 8.9 | yes |
| E2E | Full suite (smoke, quote, claim, review, Kerbie guest) plus axe against production after the final deploy | 8.4 | yes |
| Manual | The live link opened on a real phone | 8.4 | yes |

## Exit criteria

- Lighthouse ≥ 95 accessibility on key pages.
- Full E2E and axe suite passes against production after the final deploy.
- Link live in the video description.
- Script delivered.
- Load test passes without errors or pauses; every paid service has a spend cap and alert.
- Last night's backup restored successfully in the drill; runbook written.
- Security review checklist complete.
- Tagged.
