# Phase 9: Data platform (Azure + Databricks)

**Tag:** `s9-data` · **Status:** todo (placeholder, added 2 Nov 2026)

## Goal

Copy Kerb's Neon data into an Azure lakehouse and model it in Databricks: incremental loads, deletes carried through (GDPR erasure downstream), personal data dropped or bucketed before it leaves Postgres, and gold tables for the data video (quote funnel, conversion by product, pricing factors, claims lifecycle, reviews).

## Payoff shot

Delete a demo account on the live site, run the pipeline, and show the customer's rows gone from the gold tables in Databricks while the funnel numbers still add up.

## What's already in place (from 4.2)

- Every table has a change column (`updated_at`, or `created_at` / `id` for append-only tables) for watermark copies. A trigger moves `updated_at` on every update, raw SQL and foreign-key `SET NULL` included, and append-only tables refuse `UPDATE`.
- `deleted_rows` records every delete, cascades included.
- `src/server/db/data-contract.ts`: grain, keys, change column and personal-data treatment per table, kept in sync with the schema by a unit test.
- Analysable shapes: `quote_item_factors`, typed property columns, `postcode_district`, the `events` funnel table, `rating_versions` and append-only history tables.
- 12 months of synthetic history from the 4.9 seed (`users.is_synthetic`).

## Slices

Titles only; specced when the phase starts, against the code as it is then.

| # | Slice | Status |
|---|---|---|
| 9.1 | `analytics` schema in Postgres: read-only views generated from the data contract (personal data dropped, hashed or bucketed); a read-only pipeline role that can see only that schema; check whether a Neon read replica fits the plan | todo |
| 9.2 | Azure foundation: resource group, ADLS Gen2 (bronze/silver/gold containers), Key Vault for the Neon credentials, budget alerts. Infrastructure as code (Bicep or Terraform, decided then) | todo |
| 9.3 | Ingestion: Azure Data Factory (or Databricks' Postgres connector, compared then) copies each view incrementally by watermark into bronze, plus `deleted_rows`; scheduled; reruns are idempotent. Timestamps are transaction start time, so a long transaction can commit behind the watermark: copy with an overlap window and dedupe, or use Neon's logical replication instead (4.2 review) | todo |
| 9.4 | Databricks + Unity Catalog: bronze → silver (types, dedupe, deletes applied with `MERGE`) | todo |
| 9.5 | Gold models: quote funnel, conversion by product and postcode district, factor impact on price, underwriting outcomes, claims lifecycle times, review ratings; synthetic vs real split | todo |
| 9.6 | PostHog events joined via `events.anonymous_id` (PostHog export or API pull, checked then); account closure also deletes the PostHog person | todo |
| 9.7 | Data quality and erasure test: row counts reconcile with Postgres; a deleted account disappears from silver and gold | todo |
| 9.8 | Dashboards for the data video (Databricks SQL or Power BI) | todo |

## Decided early (7 Nov 2026)

Talked through before Phase 9 starts, so the 9.1, 9.3 and 9.6 specs begin from these.

- **Pipeline role (9.1):** `kerb_pipeline`, created in a hand-written migration like `0010_app_role.sql` (not in Neon's console, whose roles join `neon_superuser` and can read every table). `USAGE` on `analytics` and `SELECT` on its views only; views keep `security_invoker = false`, so the role needs no grants on `public`. `deleted_rows` is exposed as an `analytics` view too. Role settings: `default_transaction_read_only = on`, `statement_timeout = '10min'`, `idle_in_transaction_session_timeout = '1min'`, `CONNECTION LIMIT 3`. Covered by a drift check like `db:check-app-role`.
- **Load (9.1, 9.3):** ADF reads a Neon read replica (separate compute, shared storage) on its direct endpoint, not the pooler. If the plan tier rules a replica out, it reads the primary: copies are incremental on the indexed `updated_at` columns, ADF parallelism 1–2, off-peak, at most hourly. Each copy stays small so a replica conflict cancel is cheap to retry. At demo volume the load is negligible either way.
- **PostHog join (Phase 5, 9.6):**
  - Phase 5: `analytics.ts` gets `getDistinctId()`; the quote flow sends it with its server call and the server stores it in `events.anonymous_id` (format check only). `identify(user.id)` after sign-in or sign-up and `reset()` on sign-out, internal id only.
  - Cookieless visitors (rejected or not yet chosen) have a daily hash, not a stable id, so they join only in daily aggregates; row-level joins cover visitors who accepted. Say so in the 9.6 spec and the video.
  - Account closure should also delete the PostHog person (PostHog API, server-side key), so the erasure demo holds for PostHog data. Done in 9.6 (decided 7 Nov 2026); until then a closed account's PostHog person stays in PostHog.
  - Getting the data out: PostHog batch export to Azure storage if the tier allows, else ADF pulls from PostHog's query API. Checked in 9.6.

## Recording notes

- This phase feeds the separate data video; the website video can end at `s8-launch`.
- Azure and Databricks accounts, costs and spend caps are Damion's to set up; give exact steps.
