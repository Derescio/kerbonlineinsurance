import { getDb, type Db } from "#/server/db/client";
import { events } from "#/server/db/schema";
import type { BuyableProductId } from "#/features/quote/products";

// The events table's writes (engineering.md §13: server-side funnel milestones). Plain functions,
// not defineWrite: a guest records quote.started before there's anyone to check, so the permission
// suite skips this module. Nothing personal goes in `properties`.

/** quote.started (5.1, call 11). False when this journey's event exists already (plan P1). */
export async function insertQuoteStarted(
  row: {
    product: BuyableProductId;
    district: string;
    journeyId: string;
    anonymousId: string | null;
  },
  db: Db = getDb(),
): Promise<boolean> {
  const written = await db
    .insert(events)
    .values({
      name: "quote.started",
      anonymousId: row.anonymousId,
      entityType: "quote_journey",
      entityId: row.journeyId,
      properties: { product: row.product, district: row.district },
    })
    .onConflictDoNothing()
    .returning({ id: events.id });
  return written.length > 0;
}
