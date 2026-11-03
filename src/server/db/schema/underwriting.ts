import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, oneOf, updatedAt } from "./columns";
import { quoteItems } from "./quotes";
import { staffMembers } from "./staff";
import { products, ratingVersionStatuses, underwritingOutcomes } from "./values";

// One row per product and version of its rates (4.2, decision 13), filled in 4.8. Each quote item
// points at the version that rated it, so changing rates never changes an issued quote.
export const ratingVersions = pgTable(
  "rating_versions",
  {
    id: id(),
    product: text().notNull(),
    version: integer().notNull(),
    status: text().notNull().default("draft"),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("rating_versions_product_check", oneOf(t.product, products)),
    check("rating_versions_version_check", sql`${t.version} > 0`),
    check("rating_versions_status_check", oneOf(t.status, ratingVersionStatuses)),
    check(
      "rating_versions_effective_to_check",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    unique().on(t.product, t.version),
    // Only one active version per product
    uniqueIndex("rating_versions_one_active_idx")
      .on(t.product)
      .where(sql`${t.status} = 'active'`),
    index().on(t.updatedAt),
  ],
);

// Every underwriting decision on a quote item, automatic (decided_by null) or by a handler (6.11).
// Append-only: the 0002 trigger refuses UPDATE (decision 8). The current outcome is on quote_items.
export const underwritingDecisions = pgTable(
  "underwriting_decisions",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    quoteItemId: uuid()
      .notNull()
      .references(() => quoteItems.id, { onDelete: "cascade" }),
    outcome: text().notNull(),
    reasonCode: text(),
    // A handler's surcharge on approval, 0–100%
    loadingPercent: smallint(),
    decidedBy: text().references(() => staffMembers.userId),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check("underwriting_decisions_outcome_check", oneOf(t.outcome, underwritingOutcomes)),
    check(
      "underwriting_decisions_reason_code_check",
      sql`${t.outcome} = 'quoted' or ${t.reasonCode} is not null`,
    ),
    check(
      "underwriting_decisions_loading_percent_check",
      sql`${t.loadingPercent} between 0 and 100`,
    ),
    index().on(t.quoteItemId),
    index().on(t.decidedBy),
    index().on(t.createdAt),
  ],
);
