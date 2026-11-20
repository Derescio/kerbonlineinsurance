import { and, asc, eq, gte } from "drizzle-orm";

import { todayIso } from "#/features/quote/schemas/dates";
import { ipt } from "#/features/rating/money";
import { Tables } from "#/features/rating/tables";
import type { Db } from "#/server/db/client";
import { policies, quoteItems, quotes } from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

import { getRatingTables } from "./reference";

// The one-item saving's row helpers (6.1b), behind the quote save and the checkout, which already
// know whose quote it is. A same-quote bundle does not come through here: that discount is the
// two items on the quote.

export type Buyable = "car" | "home";

export function otherProduct(product: Buyable): Buyable {
  switch (product) {
    case "car":
      return "home";
    case "home":
      return "car";
    default: {
      const neverProduct: never = product;
      return neverProduct;
    }
  }
}

/** An active policy of the other product whose term has not ended. The earliest, then by id. */
export async function earningPolicy(
  db: Db | Tx,
  customerId: string,
  quoting: Buyable,
  today: string,
): Promise<{ id: string; product: Buyable } | null> {
  const [row] = await db
    .select({ id: policies.id, product: policies.product })
    .from(policies)
    .where(
      and(
        eq(policies.customerId, customerId),
        eq(policies.product, otherProduct(quoting)),
        eq(policies.status, "active"),
        gte(policies.endsOn, today),
      ),
    )
    .orderBy(asc(policies.createdAt), asc(policies.id))
    .limit(1);
  if (!row || (row.product !== "car" && row.product !== "home")) return null;
  return { id: row.id, product: row.product };
}

/** The earning policy still qualifies. False when it is missing, cancelled, lapsed or ended. */
export async function policyStillEarns(
  db: Db | Tx,
  policyId: string,
  customerId: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ status: policies.status, endsOn: policies.endsOn })
    .from(policies)
    .where(and(eq(policies.id, policyId), eq(policies.customerId, customerId)))
    .limit(1);
  return Boolean(row && row.status === "active" && row.endsOn >= todayIso(now));
}

/**
 * Takes the one-item saving off a quote whose earning policy no longer qualifies, and returns
 * that policy's product so the pay screen can say which one. The existing policy is not changed.
 */
export async function dropMultiPolicySaving(tx: Tx, quoteId: string): Promise<Buyable> {
  const [quote] = await tx
    .select({
      subtotalPence: quotes.subtotalPence,
      feesPence: quotes.feesPence,
      bundlePolicyId: quotes.bundlePolicyId,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId));
  if (!quote?.bundlePolicyId)
    throw new Error("dropMultiPolicySaving: the quote has no earning policy");
  const [policy] = await tx
    .select({ product: policies.product })
    .from(policies)
    .where(eq(policies.id, quote.bundlePolicyId));
  const [item] = await tx
    .select({ ratingVersionId: quoteItems.ratingVersionId })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .limit(1);
  if (!item) throw new Error("dropMultiPolicySaving: the quote has no item");
  const iptRate = new Tables(await getRatingTables(tx, item.ratingVersionId)).param("ipt_rate");
  const iptPence = ipt(quote.subtotalPence, iptRate);
  await tx
    .update(quotes)
    .set({
      bundleDiscountPence: 0,
      bundlePolicyId: null,
      iptPence,
      totalPence: quote.subtotalPence + quote.feesPence + iptPence,
    })
    .where(eq(quotes.id, quoteId));
  return policy?.product === "home" ? "home" : "car";
}
