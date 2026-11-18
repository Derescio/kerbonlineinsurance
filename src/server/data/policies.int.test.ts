import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { bundles, quotes } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makePayment, makePolicy, makeQuote, makeUser } from "#/test/factories";

import { listMyPolicies } from "./policies";

// The account page's "Your policies" (5.6, decision 12; 5.6b, decision 9): a policy is monthly
// when its quote's payments are a Stripe subscription, which is what /account/billing's portal
// can change the card on.

beforeEach(truncateAll);
afterAll(closeDb);

async function signedInCustomer() {
  const user = await makeUser();
  const customer = await makeCustomer({ userId: user.id });
  const actor = (await resolveActor(getDb(), user.id))!;
  return { customer, actor };
}

describe("listMyPolicies: monthly", () => {
  it("is true for a policy whose quote is paid by a Stripe subscription, false otherwise", async () => {
    const { customer, actor } = await signedInCustomer();

    const monthly = await makePolicy({ customerId: customer.id });
    for (const instalmentNumber of [1, 2]) {
      await makePayment({
        customerId: customer.id,
        quoteId: monthly.quoteId,
        plan: "monthly",
        instalmentNumber,
        stripeSubscriptionId: "sub_test_1",
        status: instalmentNumber === 1 ? "succeeded" : "scheduled",
        paidAt: instalmentNumber === 1 ? new Date() : null,
      });
    }
    const annual = await makePolicy({ customerId: customer.id });
    await makePayment({ customerId: customer.id, quoteId: annual.quoteId });
    // 5.6's demo monthly rows have no subscription: no card to update in Stripe's portal
    const demo = await makePolicy({ customerId: customer.id });
    await makePayment({
      customerId: customer.id,
      quoteId: demo.quoteId,
      plan: "monthly",
      instalmentNumber: 1,
    });

    const listed = await listMyPolicies(actor, {});
    const monthlyOf = Object.fromEntries(listed.map((p) => [p.id, p.monthly]));
    expect(monthlyOf).toEqual({ [monthly.id]: true, [annual.id]: false, [demo.id]: false });
    // One row per policy, however many instalments
    expect(listed).toHaveLength(3);
  });

  it("only reads the customer's own payments", async () => {
    const { customer, actor } = await signedInCustomer();
    const mine = await makePolicy({ customerId: customer.id });
    const other = await makePolicy();
    await makePayment({
      customerId: other.customerId,
      quoteId: other.quoteId,
      plan: "monthly",
      instalmentNumber: 1,
      stripeSubscriptionId: "sub_other",
    });
    expect(await listMyPolicies(actor, {})).toEqual([
      expect.objectContaining({ id: mine.id, monthly: false }),
    ]);
  });
});

describe("listMyPolicies: a bundle (5.7b, Damion's preview check)", () => {
  it("names each bundled policy's bundle and the saving its quote gave", async () => {
    const { customer, actor } = await signedInCustomer();
    const { quote, items } = await makeQuote({
      customerId: customer.id,
      products: ["car", "home"],
    });
    await getDb()
      .update(quotes)
      .set({ bundleDiscountPence: 15_856, totalPence: quote.totalPence - 15_856 })
      .where(eq(quotes.id, quote.id));
    const [bundle] = await getDb()
      .insert(bundles)
      .values({ customerId: customer.id, quoteId: quote.id })
      .returning();
    for (const { item } of items) {
      await makePolicy({
        customerId: customer.id,
        quoteId: quote.id,
        quoteItemId: item.id,
        product: item.product,
        bundleId: bundle!.id,
      });
    }
    const single = await makePolicy({ customerId: customer.id });

    const listed = await listMyPolicies(actor, {});
    const bundled = listed.filter((p) => p.bundle);
    expect(bundled.map((p) => p.product).sort()).toEqual(["car", "home"]);
    expect(bundled.every((p) => p.bundle?.id === bundle!.id)).toBe(true);
    expect(bundled[0]!.bundle?.savingPence).toBe(15_856);
    expect(listed.find((p) => p.id === single.id)?.bundle).toBeNull();
  });
});
