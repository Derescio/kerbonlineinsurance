import { getRandomValues, randomInt } from "node:crypto";

import { eq } from "drizzle-orm";

import type { PricedQuote } from "#/features/rating/price-quote";
import { getDb, type Db } from "#/server/db/client";
import {
  businesses,
  drivers,
  properties,
  quoteItemAddons,
  quoteItemFactors,
  quoteItemOptions,
  quoteItems,
  quotes,
  underwritingDecisions,
  vehicles,
} from "#/server/db/schema";

import { withTx } from "#/server/db/tx";

import { quoteRows, type SaveItem } from "./quote-rows";

// saveQuote() (5.4, spec decision 2): a priced quote and everything under it, in one transaction.
// Built and tested here; 5.6 calls it after sign-in and adds its idempotency key and rate limit.

const VALID_DAYS = 30;
const REFERENCE_TRIES = 5;
const UNIQUE_VIOLATION = "23505";

/**
 * Time-ordered ids, like Postgres 18's uuidv7() (4.2 decision 3), counting up within one save: the
 * 12 bits after the time are a counter, so rows sort by id in the order they were built. Named
 * drivers keep their entry order that way, and "named driver 2" finds the right row (decision 14).
 */
function idsAt(at: Date): () => string {
  let counter = 0;
  return () => {
    const bytes = getRandomValues(new Uint8Array(16));
    let ms = at.getTime();
    for (let i = 5; i >= 0; i--) {
      bytes[i] = ms % 256;
      ms = Math.floor(ms / 256);
    }
    bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    counter++;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** KRB-Q-10000 to KRB-Q-89999: below the seed's 9 range (4.9 call 19) */
const drawReference = () => `KRB-Q-${randomInt(10_000, 90_000)}`;

function isReferenceClash(error: unknown): boolean {
  const pg = ((error as { cause?: unknown }).cause ?? error) as {
    code?: string;
    constraint?: string;
  };
  return pg.code === UNIQUE_VIOLATION && pg.constraint === "quotes_reference_unique";
}

export interface SaveQuoteInput {
  customerId: string;
  postcode: string;
  priced: PricedQuote;
  /** One per priced item, in the same order */
  items: readonly SaveItem[];
  now?: Date;
}

export async function saveQuote(
  db: Db = getDb(),
  input: SaveQuoteInput,
  deps: { drawReference?: () => string } = {},
): Promise<{ quoteId: string; reference: string }> {
  const at = input.now ?? new Date();
  const draw = deps.drawReference ?? drawReference;
  for (let attempt = 1; ; attempt++) {
    const newId = idsAt(at);
    const rows = quoteRows(input.priced, {
      quoteId: newId(),
      reference: draw(),
      customerId: input.customerId,
      postcode: input.postcode,
      at,
      validUntil: new Date(at.getTime() + VALID_DAYS * 86_400_000),
      newId,
      items: input.items,
    });
    try {
      await withTx(db, async (tx) => {
        await tx.insert(quotes).values(rows.quote);
        // The selection points at one of the item's options, so it's set once they exist
        await tx
          .insert(quoteItems)
          .values(rows.items.map((i) => ({ ...i, selectedOptionId: null })));
        if (rows.options.length) await tx.insert(quoteItemOptions).values(rows.options);
        for (const item of rows.items) {
          if (!item.selectedOptionId) continue;
          await tx
            .update(quoteItems)
            .set({ selectedOptionId: item.selectedOptionId })
            .where(eq(quoteItems.id, item.id));
        }
        if (rows.addons.length) await tx.insert(quoteItemAddons).values(rows.addons);
        if (rows.factors.length) await tx.insert(quoteItemFactors).values(rows.factors);
        if (rows.vehicles.length) await tx.insert(vehicles).values(rows.vehicles);
        if (rows.drivers.length) await tx.insert(drivers).values(rows.drivers);
        if (rows.properties.length) await tx.insert(properties).values(rows.properties);
        if (rows.businesses.length) await tx.insert(businesses).values(rows.businesses);
        await tx.insert(underwritingDecisions).values(rows.decisions);
      });
      return { quoteId: rows.quote.id, reference: rows.quote.reference };
    } catch (error) {
      if (attempt < REFERENCE_TRIES && isReferenceClash(error)) continue;
      throw error;
    }
  }
}
