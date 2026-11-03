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
| 9.6 | PostHog events joined via `events.anonymous_id` (PostHog export or API pull, checked then) | todo |
| 9.7 | Data quality and erasure test: row counts reconcile with Postgres; a deleted account disappears from silver and gold | todo |
| 9.8 | Dashboards for the data video (Databricks SQL or Power BI) | todo |

## Recording notes

- This phase feeds the separate data video; the website video can end at `s8-launch`.
- Azure and Databricks accounts, costs and spend caps are Damion's to set up; give exact steps.
