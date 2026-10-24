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

## Exit criteria

- Lighthouse ≥ 95 accessibility on key pages.
- Link live in the video description.
- Script delivered.
- Load test passes without errors or pauses; every paid service has a spend cap and alert.
- Last night's backup restored successfully in the drill; runbook written.
- Security review checklist complete.
- Tagged.
