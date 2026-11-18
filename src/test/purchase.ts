import { eq } from "drizzle-orm";

import { getDb } from "#/server/db/client";
import { quoteItems, quotes } from "#/server/db/schema";

import { makePayment, makePolicy, makeQuote } from "./factories";

/**
 * An accepted car quote with its policy and payments, as Task 5's pay will leave it (5.6). The
 * factory's quote is re-pointed at `ratingVersionId` (a real version, so its credit charge loads),
 * and a monthly plan gets its 12 instalments.
 */
export async function makePurchase({
  customerId,
  ratingVersionId,
  plan = "annual",
}: {
  customerId: string;
  ratingVersionId: string;
  plan?: "annual" | "monthly";
}) {
  const db = getDb();
  const { quote, items } = await makeQuote({ customerId });
  await db.update(quoteItems).set({ ratingVersionId }).where(eq(quoteItems.id, items[0]!.item.id));
  const now = new Date();
  const [accepted] = await db
    .update(quotes)
    .set({
      status: "accepted",
      paymentPlan: plan,
      detailsConfirmedAt: now,
      coverAcknowledgedAt: now,
    })
    .where(eq(quotes.id, quote.id))
    .returning();
  const policy = await makePolicy({
    customerId,
    quoteId: quote.id,
    quoteItemId: items[0]!.item.id,
  });
  const instalments = plan === "monthly" ? 12 : 1;
  for (let n = 1; n <= instalments; n++) {
    await makePayment({
      customerId,
      quoteId: quote.id,
      plan,
      instalmentNumber: n,
      amountPence: plan === "monthly" ? 5_000 : accepted!.totalPence,
      status: n === 1 ? "succeeded" : "scheduled",
      paidAt: n === 1 ? now : null,
      dueOn: `2026-${String(11 + n > 12 ? 11 + n - 12 : 11 + n).padStart(2, "0")}-15`,
      cardBrand: "visa",
      cardLast4: "4242",
    });
  }
  return { quote: accepted!, policy };
}
