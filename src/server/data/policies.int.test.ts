import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import {
  bundles,
  drivers,
  policies,
  policyChanges,
  policyVersions,
  properties,
  quoteItemAddons,
  quotes,
  vehicles,
} from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import {
  makeCustomer,
  makePayment,
  makePolicy,
  makeQuote,
  makeUser,
  rewriteVersionOne,
} from "#/test/factories";

import { getMyNextPayment, getMyPolicy, listMyPolicies } from "./policies";

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

describe("getMyPolicy (6.2)", () => {
  it("gives a car policy with its car, drivers (main first), add-ons, excesses and annual plan", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id, voluntaryExcessPence: 15_000 });
    await getDb()
      .update(policies)
      .set({ annualPremiumPence: 54_500 })
      .where(eq(policies.id, policy.id));
    await getDb().insert(drivers).values({
      quoteItemId: policy.quoteItemId,
      firstName: "Sam",
      lastName: "Taylor",
      dateOfBirth: "1992-02-02",
      occupation: "nurse",
      licenceYears: 3,
      noClaimsYears: 0,
      relationship: "spouse",
    });
    await getDb()
      .update(quoteItemAddons)
      .set({ selected: true })
      .where(eq(quoteItemAddons.quoteItemId, policy.quoteItemId));
    await makePayment({ customerId: customer.id, quoteId: policy.quoteId });
    await rewriteVersionOne(policy.id);

    const detail = await getMyPolicy(actor, { reference: policy.reference });
    expect(detail).toMatchObject({
      reference: policy.reference,
      product: "car",
      compulsoryExcessPence: 25_000,
      voluntaryExcessPence: 15_000,
      car: {
        make: "Volkswagen",
        model: "Golf",
        variant: "1.5 TSI Life",
        year: 2019,
        registration: "AB19 CDE",
        usage: "commuting",
      },
      home: null,
      policyholder: { firstName: "Alex", lastName: "Taylor", postcode: "SW1A 1AA" },
      coverPremiumPence: 50_000,
      addons: [{ addon: "breakdown_uk", annualPricePence: 4_500 }],
      saving: null,
      bundled: false,
      plan: { kind: "annual" },
    });
    expect(detail.drivers.map((d) => [d.firstName, d.isMain, d.relationship])).toEqual([
      ["Alex", true, null],
      ["Sam", false, "spouse"],
    ]);
    expect(detail.boughtOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail).not.toHaveProperty("customerId");
    expect(detail).not.toHaveProperty("quoteId");
  });

  it("shows the latest version's money, with details from the rows (6.3b)", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id });
    const [v1] = await getDb()
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policy.id));
    const snapshot = v1!.snapshot as { money: Record<string, unknown> };
    const [change] = await getDb()
      .insert(policyChanges)
      .values({
        policyId: policy.id,
        customerId: customer.id,
        kind: "cover",
        request: {},
        fromVersion: 1,
        toVersion: 2,
        oldAnnualPence: 50_000,
        newAnnualPence: 61_000,
        priceBeforePence: 56_000,
        priceAfterPence: 68_320,
        outcome: "quoted",
        settlement: "none",
        amountPence: 0,
        status: "applied",
        appliedAt: new Date(),
      })
      .returning();
    await getDb()
      .insert(policyVersions)
      .values({
        policyId: policy.id,
        version: 2,
        effectiveFrom: new Date(),
        policyChangeId: change!.id,
        snapshot: {
          ...snapshot,
          money: {
            ...snapshot.money,
            tierPence: 61_000,
            addons: [{ addon: "courtesy_car", annualPricePence: 3_200 }],
            quoteTotalPence: 68_320,
          },
        },
        personal: v1!.personal,
      });

    const detail = await getMyPolicy(actor, { reference: policy.reference });
    expect(detail.coverPremiumPence).toBe(61_000);
    expect(detail.addons).toEqual([{ addon: "courtesy_car", annualPricePence: 3_200 }]);
    expect(detail.quote.totalPence).toBe(68_320);
    // Details still come from the rows
    expect(detail.drivers.map((d) => d.firstName)).toEqual(["Alex"]);
  });

  it("says whether a policy can be changed online (6.3b)", async () => {
    const { customer, actor } = await signedInCustomer();
    const car = await makePolicy({
      customerId: customer.id,
      startsOn: "2026-01-01",
      endsOn: "2099-12-31",
    });
    const home = await makePolicy({
      customerId: customer.id,
      product: "home",
      endsOn: "2099-12-31",
    });
    const carDetail = await getMyPolicy(actor, { reference: car.reference });
    expect(carDetail.changes).toEqual({ eligible: true, latest: null });
    expect(carDetail.drivers[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getMyPolicy(actor, { reference: home.reference })).changes.eligible).toBe(false);
    await getDb()
      .update(policies)
      .set({ status: "lapsed", lapsedAt: new Date() })
      .where(eq(policies.id, car.id));
    expect((await getMyPolicy(actor, { reference: car.reference })).changes.eligible).toBe(false);
  });

  it("gives a home policy with its property and no drivers", async () => {
    const { customer, actor } = await signedInCustomer();
    const policy = await makePolicy({ customerId: customer.id, product: "home" });
    const detail = await getMyPolicy(actor, { reference: policy.reference });
    expect(detail.car).toBeNull();
    expect(detail.drivers).toEqual([]);
    expect(detail.home).toMatchObject({
      addressLine1: "1 Test Street",
      propertyType: "terraced",
      rebuildCostPence: 30_000_000,
      contentsValuePence: 4_000_000,
      valuablesPence: null,
    });
  });

  it("names a bundle's share of the saving and the monthly instalment for both", async () => {
    const { customer, actor } = await signedInCustomer();
    const { quote, items } = await makeQuote({
      customerId: customer.id,
      products: ["car", "home"],
    });
    await getDb()
      .update(quotes)
      .set({
        bundleDiscountPence: 8_000,
        paymentPlan: "monthly",
        totalPence: quote.totalPence - 8_000,
      })
      .where(eq(quotes.id, quote.id));
    const [bundle] = await getDb()
      .insert(bundles)
      .values({ customerId: customer.id, quoteId: quote.id })
      .returning();
    const home = await makePolicy({
      customerId: customer.id,
      quoteId: quote.id,
      quoteItemId: items.find((i) => i.item.product === "home")!.item.id,
      product: "home",
      bundleId: bundle!.id,
      annualPremiumPence: 46_000,
    });
    for (const [instalmentNumber, amountPence] of [
      [1, 9_000],
      [2, 8_500],
    ] as const) {
      await makePayment({
        customerId: customer.id,
        quoteId: quote.id,
        plan: "monthly",
        instalmentNumber,
        amountPence,
      });
    }
    await rewriteVersionOne(home.id);

    const detail = await getMyPolicy(actor, { reference: home.reference });
    expect(detail.saving).toEqual({ kind: "bundle", pence: 4_000 });
    expect(detail.bundled).toBe(true);
    expect(detail.plan).toEqual({ kind: "monthly", instalmentPence: 8_500 });
  });

  it("calls a saving from an earlier policy earned", async () => {
    const { customer, actor } = await signedInCustomer();
    const car = await makePolicy({ customerId: customer.id });
    const home = await makePolicy({
      customerId: customer.id,
      product: "home",
      annualPremiumPence: 46_000,
    });
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, home.quoteId));
    await getDb()
      .update(quotes)
      .set({
        bundleDiscountPence: 4_000,
        bundlePolicyId: car.id,
        totalPence: quote!.totalPence - 4_000,
      })
      .where(eq(quotes.id, home.quoteId));
    await rewriteVersionOne(home.id);
    const detail = await getMyPolicy(actor, { reference: home.reference });
    expect(detail.saving).toEqual({ kind: "earned", pence: 4_000 });
  });

  it("hides another customer's policy, and gives none to a user with no customer row", async () => {
    const { actor } = await signedInCustomer();
    const other = await makePolicy();
    await expect(getMyPolicy(actor, { reference: other.reference })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const loner = await makeUser();
    const lonerActor = (await resolveActor(getDb(), loner.id))!;
    await expect(getMyPolicy(lonerActor, { reference: other.reference })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
