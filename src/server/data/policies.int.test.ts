import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { bundles, properties, quotes, vehicles } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makePayment, makePolicy, makeQuote, makeUser } from "#/test/factories";

import { getMyNextPayment, listMyPolicies } from "./policies";

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

describe("listMyPolicies: a saving an earlier policy earned (6.1b)", () => {
  it("names the earning policy and the saving on its quote, with no bundle", async () => {
    const { customer, actor } = await signedInCustomer();
    const car = await makePolicy({ customerId: customer.id });
    const home = await makePolicy({ customerId: customer.id, product: "home" });
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, home.quoteId));
    await getDb()
      .update(quotes)
      .set({
        bundleDiscountPence: 3_814,
        bundlePolicyId: car.id,
        totalPence: quote!.totalPence - 3_814,
      })
      .where(eq(quotes.id, home.quoteId));

    const byId = Object.fromEntries((await listMyPolicies(actor, {})).map((p) => [p.id, p]));
    expect(byId[home.id]!.earnedBy).toEqual({ policyId: car.id, savingPence: 3_814 });
    expect(byId[home.id]!.bundle).toBeNull();
    expect(byId[car.id]!.earnedBy).toBeNull();
  });
});

describe("listMyPolicies: label (6.1)", () => {
  it("names a car by its plate, make and model, and a home by its address", async () => {
    const { customer, actor } = await signedInCustomer();
    const car = await makePolicy({ customerId: customer.id });
    await getDb()
      .update(vehicles)
      .set({ registration: "KR24 BXL" })
      .where(eq(vehicles.quoteItemId, car.quoteItemId));
    const home = await makePolicy({ customerId: customer.id, product: "home" });
    await getDb()
      .update(properties)
      .set({ addressLine1: "11 Rosebery Gardens", town: "London" })
      .where(eq(properties.quoteItemId, home.quoteItemId));

    const byId = Object.fromEntries((await listMyPolicies(actor, {})).map((p) => [p.id, p]));
    expect(byId[car.id]!.label).toEqual({
      kind: "car",
      plate: "KR24 BXL",
      make: "Volkswagen",
      model: "Golf",
    });
    expect(byId[home.id]!.label).toEqual({
      kind: "home",
      line1: "11 Rosebery Gardens",
      town: "London",
    });
    expect(byId[car.id]!.annualPremiumPence).toBe(50_000);
  });

  it("has no plate for a car picked from the catalogue without one", async () => {
    const { customer, actor } = await signedInCustomer();
    const car = await makePolicy({ customerId: customer.id });
    await getDb()
      .update(vehicles)
      .set({ registration: null })
      .where(eq(vehicles.quoteItemId, car.quoteItemId));
    const [listed] = await listMyPolicies(actor, {});
    expect(listed!.label).toEqual({ kind: "car", plate: null, make: "Volkswagen", model: "Golf" });
  });

  it("lists nothing of another customer's, and nothing for a user with no customer row", async () => {
    const { actor } = await signedInCustomer();
    await makePolicy();
    expect(await listMyPolicies(actor, {})).toEqual([]);
    const loner = await makeUser();
    const lonerActor = (await resolveActor(getDb(), loner.id))!;
    expect(await listMyPolicies(lonerActor, {})).toEqual([]);
  });
});

describe("getMyNextPayment (6.1)", () => {
  // 23:30 UTC on 1 Jul is 00:30 on 2 Jul in London (summer time)
  const now = new Date("2026-07-01T23:30:00Z");

  async function unpaid(customerId: string, dueOn: string, extra = {}) {
    const policy = await makePolicy({ customerId });
    return makePayment({
      customerId,
      quoteId: policy.quoteId,
      plan: "monthly",
      instalmentNumber: 2,
      amountPence: 4_470,
      status: "scheduled",
      paidAt: null,
      dueOn,
      ...extra,
    });
  }

  it("is the earliest unpaid payment due today in London, not overdue", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-07-02");
    await unpaid(customer.id, "2026-08-02");
    expect(await getMyNextPayment(actor, { now })).toEqual({
      kind: "due",
      amountPence: 4_470,
      dueOn: "2026-07-02",
    });
  });

  it("keeps a scheduled payment due yesterday as the next one, so a late webhook isn't overdue", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-07-01");
    expect(await getMyNextPayment(actor, { now })).toEqual({
      kind: "due",
      amountPence: 4_470,
      dueOn: "2026-07-01",
    });
  });

  it("calls a scheduled payment overdue once it is two days late", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-06-30");
    expect(await getMyNextPayment(actor, { now })).toEqual({
      kind: "overdue",
      outstandingPence: 4_470,
    });
  });

  it("calls a failed payment overdue the day after it was due", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-07-01", { status: "failed" });
    expect(await getMyNextPayment(actor, { now })).toEqual({
      kind: "overdue",
      outstandingPence: 4_470,
    });
  });

  it("adds up every overdue payment, across subscriptions", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-06-15", { status: "failed", stripeSubscriptionId: "sub_a" });
    await unpaid(customer.id, "2026-06-20", { amountPence: 2_000, stripeSubscriptionId: "sub_b" });
    await unpaid(customer.id, "2026-07-10");
    expect(await getMyNextPayment(actor, { now })).toEqual({
      kind: "overdue",
      outstandingPence: 6_470,
    });
  });

  it("is none when everything is paid, or for someone else's unpaid payment", async () => {
    const { customer, actor } = await signedInCustomer();
    await makePayment({ customerId: customer.id });
    const other = await makeCustomer();
    await unpaid(other.id, "2026-07-05");
    expect(await getMyNextPayment(actor, { now })).toEqual({ kind: "none" });
  });

  it("leaves out a month Kerb voided while the cover had lapsed, which is never owed", async () => {
    const { customer, actor } = await signedInCustomer();
    await unpaid(customer.id, "2026-06-15", { status: "failed", voidedAt: new Date() });
    expect(await getMyNextPayment(actor, { now })).toEqual({ kind: "none" });
  });

  it("leaves out the instalments of a cancelled policy", async () => {
    const { customer, actor } = await signedInCustomer();
    const cancelled = await makePolicy({
      customerId: customer.id,
      status: "cancelled",
      cancelledAt: new Date(),
    });
    for (const [instalmentNumber, dueOn] of [
      [2, "2026-06-20"],
      [3, "2026-07-20"],
    ] as const) {
      await makePayment({
        customerId: customer.id,
        quoteId: cancelled.quoteId,
        plan: "monthly",
        instalmentNumber,
        status: "scheduled",
        paidAt: null,
        dueOn,
      });
    }
    expect(await getMyNextPayment(actor, { now })).toEqual({ kind: "none" });
  });

  it("is none for a user with no customer row", async () => {
    const loner = await makeUser();
    const actor = (await resolveActor(getDb(), loner.id))!;
    expect(await getMyNextPayment(actor, { now })).toEqual({ kind: "none" });
  });
});
