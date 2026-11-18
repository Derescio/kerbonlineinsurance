import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { areaVerb, createdAt, id } from "./columns";

// For the Azure + Databricks pipeline (Phase 9; 4.2, decision 16).

// Tombstones: the 0002 record_delete() trigger writes one row per deleted row of every copied
// table (cascades included), so a watermark copy learns about deletes. Written only by the trigger.
export const deletedRows = pgTable(
  "deleted_rows",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tableName: text().notNull(),
    // Composite keys joined with `:`
    rowId: text().notNull(),
    deletedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // The pipeline's watermark
  (t) => [index().on(t.deletedAt)],
);

// Funnel and product events, recorded as they happen from Phase 5 (quote started → priced →
// referred → bought). Append-only. No personal data in `properties`; no foreign key to users, so
// events outlive accounts the way audit rows do.
export const events = pgTable(
  "events",
  {
    id: id(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // e.g. quote.started, quote.priced, policy.bought, claim.opened
    name: text().notNull(),
    userId: text(),
    // PostHog's distinct id, so the two can be joined
    anonymousId: text(),
    entityType: text(),
    entityId: text(),
    properties: jsonb().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    check("events_name_check", areaVerb(t.name)),
    check("events_entity_check", sql`(${t.entityType} is null) = (${t.entityId} is null)`),
    index().on(t.name, t.occurredAt),
    index().on(t.userId),
    index().on(t.createdAt),
    // One quote.started per journey (5.1, plan P1): the browser's random journey id is the entity, so a
    // repeat or a race between two calls writes nothing
    uniqueIndex("events_quote_started_journey_unique")
      .on(t.entityId)
      .where(sql`${t.name} = 'quote.started'`),
  ],
);
