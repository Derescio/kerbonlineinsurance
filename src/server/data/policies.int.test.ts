import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { truncateAll } from "#/test/db";
import { makeCustomer, makePayment, makePolicy, makeUser } from "#/test/factories";

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
