import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { monthlyPayment } from "#/features/rating/money";
import { resolveActor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { quotes } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { saveCarQuoteFor } from "#/server/quote/save";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer, makeStaff, makeUser } from "#/test/factories";
import { makePurchase } from "#/test/purchase";

import {
  clearReferenceCaches,
  getActiveRatingTables,
  getCatalogue,
  upsertReferenceData,
} from "./reference";
import { getPurchase, getQuoteForPayment, listMyQuotes } from "./quotes";

// The owner-only reads behind Confirm and pay, You're covered and Your saved quotes (5.6,
// decisions 6, 9 and 10): each filters by the signed-in customer, and a quote that isn't theirs is
// NOT_FOUND. Quotes are saved through saveCarQuoteFor, the way the gate saves them.

const DAY = 24 * 60 * 60 * 1000;
// The fixture's dates hold on 11 Nov 2026; the saved quote's validity runs from this
const SAVED_AT = new Date("2026-11-11T12:00:00Z");

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

async function signedUp() {
  const user = await makeUser();
  const customer = await makeCustomer({ userId: user.id });
  const actor = (await resolveActor(getDb(), user.id))!;
  return { customer, actor, email: user.email };
}

async function saveFor(userId: string, journey?: Journey, now = SAVED_AT) {
  const result = await withTx(getDb(), async (tx) =>
    saveCarQuoteFor(tx, userId, { journey: journey ?? (await golf()), now }),
  );
  if (result.status !== "saved") throw new Error(`not saved: ${result.status}`);
  return result;
}

/** A customer made by the first save, with a quote and an actor that knows its customer row */
async function customerWithQuote(journey?: Journey) {
  // The first save makes the customer row (decision 4), so only the user exists before it
  const user = await makeUser();
  const saved = await saveFor(user.id, journey);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, saved, userId: user.id };
}

async function codeOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof AuthzError) return error.code;
    throw error;
  }
}

beforeAll(async () => {
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  vi.useRealTimers();
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
});
afterAll(closeDb);

describe("listMyQuotes", () => {
  it("lists only the signed-in customer's quotes, newest first", async () => {
    const a = await customerWithQuote();
    const b = await customerWithQuote();
    // A minute later, so the order is by time (quotes saved at one instant tie)
    const second = await saveFor(a.userId, undefined, new Date(SAVED_AT.getTime() + 60_000));
    const mine = await listMyQuotes(a.actor, {});
    expect(mine.map((q) => q.quoteId)).toEqual([second.quoteId, a.saved.quoteId]);
    expect((await listMyQuotes(b.actor, {})).map((q) => q.quoteId)).toEqual([b.saved.quoteId]);
  });

  it("gives the card its car, cover, totals and postcode", async () => {
    const { actor, saved } = await customerWithQuote();
    const [card] = await listMyQuotes(actor, {});
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    const rate = (await getActiveRatingTables("car")).parameters.monthly_credit_charge_rate!;
    expect(card).toMatchObject({
      quoteId: saved.quoteId,
      reference: saved.reference,
      state: "ready",
      car: { make: "Volkswagen", model: "Golf" },
      coverLevel: "comprehensive",
      annualTotalPence: row!.totalPence,
      monthlyPaymentPence: monthlyPayment(row!.totalPence, rate),
      policyReference: null,
      postcode: "E8 3RL",
    });
  });

  it("shows each state from the status and the date", async () => {
    const { actor, saved } = await customerWithQuote();
    const setQuote = (values: Partial<typeof quotes.$inferInsert>) =>
      getDb().update(quotes).set(values).where(eq(quotes.id, saved.quoteId));
    const stateNow = async () => (await listMyQuotes(actor, {}))[0]?.state;

    expect(await stateNow()).toBe("ready");
    await setQuote({ status: "referred" });
    expect(await stateNow()).toBe("review");
    // A lapsed validity wins over priced and referred
    await setQuote({ validUntil: new Date(Date.now() - DAY) });
    expect(await stateNow()).toBe("expired");
    await setQuote({ status: "priced" });
    expect(await stateNow()).toBe("expired");
    // Accepted is bought even after its validity has gone
    const now = new Date();
    await setQuote({
      status: "accepted",
      paymentPlan: "annual",
      detailsConfirmedAt: now,
      coverAcknowledgedAt: now,
    });
    expect(await stateNow()).toBe("bought");
  });

  it("leaves a declined quote out and gives staff an empty list", async () => {
    const { actor, saved } = await customerWithQuote();
    await getDb().update(quotes).set({ status: "declined" }).where(eq(quotes.id, saved.quoteId));
    expect(await listMyQuotes(actor, {})).toEqual([]);
    const staff = await makeStaff({ roles: ["claims_handler"] });
    const staffActor = (await resolveActor(getDb(), staff.userId, {
      twoFactorVerifiedAt: new Date(),
    }))!;
    expect(await listMyQuotes(staffActor, {})).toEqual([]);
  });

  it("shows the bought quote's policy reference", async () => {
    const { actor, customer } = await signedUp();
    const { policy } = await makePurchase({
      customerId: customer.id,
      ratingVersionId: (await getActiveRatingTables("car")).id,
    });
    const [card] = await listMyQuotes(actor, {});
    expect(card).toMatchObject({ state: "bought", policyReference: policy.reference });
  });
});

describe("getQuoteForPayment", () => {
  it("gives the payer's quote with the monthly payment from the quote's rate", async () => {
    const { actor, saved } = await customerWithQuote();
    const summary = await getQuoteForPayment(actor, { quoteId: saved.quoteId });
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    const rate = (await getActiveRatingTables("car")).parameters.monthly_credit_charge_rate!;
    expect(summary).toMatchObject({
      quoteId: saved.quoteId,
      reference: saved.reference,
      status: "priced",
      expired: false,
      policyholder: { firstName: "Alex", lastName: "Morgan" },
      car: { make: "Volkswagen", model: "Golf" },
      coverLevel: "comprehensive",
      voluntaryExcessPence: 0,
      annualTotalPence: row!.totalPence,
      monthlyPaymentPence: monthlyPayment(row!.totalPence, rate),
      startDate: "2026-11-12",
      addons: [],
    });
    expect(summary.compulsoryExcessPence).toBeGreaterThan(0);
  });

  it("marks a lapsed quote expired", async () => {
    const { actor, saved } = await customerWithQuote();
    await getDb()
      .update(quotes)
      .set({ validUntil: new Date(Date.now() - DAY) })
      .where(eq(quotes.id, saved.quoteId));
    expect(await getQuoteForPayment(actor, { quoteId: saved.quoteId })).toMatchObject({
      expired: true,
    });
  });

  it("lists the selected add-ons", async () => {
    const journey = await golf();
    journey.cover = { coverLevel: "plus", voluntaryExcessPence: 25_000, addons: ["breakdown_uk"] };
    const { actor, saved } = await customerWithQuote(journey);
    expect(await getQuoteForPayment(actor, { quoteId: saved.quoteId })).toMatchObject({
      coverLevel: "plus",
      voluntaryExcessPence: 25_000,
      addons: ["breakdown_uk"],
    });
  });

  it("keeps the monthly payment from the version that priced the quote", async () => {
    const { actor, saved } = await customerWithQuote();
    const v1 = await getActiveRatingTables("car");
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));

    // Car v2 with a different credit charge, activated by the deploy
    const carV1 = RATING_SOURCES.find((s) => s.product === "car")!;
    const v2Rate = v1.parameters.monthly_credit_charge_rate! + 0.25;
    const v2 = {
      ...structuredClone(carV1),
      version: 2,
      effectiveFrom: "2026-11-12",
      notes: "test v2",
      parameters: { ...carV1.parameters, monthly_credit_charge_rate: v2Rate },
    };
    clearReferenceCaches();
    await upsertReferenceData(getOwnerDb(), {
      rating: [...structuredClone(RATING_SOURCES), v2],
      catalogue: structuredClone(CATALOGUE_SOURCES),
    });
    const active = await getActiveRatingTables("car");
    expect(active.id).not.toBe(v1.id);
    expect(active.parameters.monthly_credit_charge_rate!).toBe(v2Rate);

    const expected = monthlyPayment(row!.totalPence, v1.parameters.monthly_credit_charge_rate!);
    expect(monthlyPayment(row!.totalPence, v2Rate)).not.toBe(expected);
    expect((await getQuoteForPayment(actor, { quoteId: saved.quoteId })).monthlyPaymentPence).toBe(
      expected,
    );
    expect((await listMyQuotes(actor, {}))[0]!.monthlyPaymentPence).toBe(expected);
  });

  it("hides someone else's quote as not found", async () => {
    const a = await customerWithQuote();
    const b = await customerWithQuote();
    expect(await codeOf(() => getQuoteForPayment(b.actor, { quoteId: a.saved.quoteId }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(() => getQuoteForPayment(a.actor, { quoteId: randomUUID() }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(() => getQuoteForPayment(a.actor, { quoteId: "nope" }))).toBe("NOT_FOUND");
  });
});

describe("getPurchase", () => {
  it("gives an annual purchase with its card, policy and car", async () => {
    const { actor, customer, email } = await signedUp();
    const ratingVersionId = (await getActiveRatingTables("car")).id;
    const { quote, policy } = await makePurchase({
      customerId: customer.id,
      ratingVersionId,
    });
    const purchase = await getPurchase(actor, { quoteId: quote.id });
    expect(purchase).toEqual({
      firstName: "Alex",
      email,
      plan: "annual",
      card: { brand: "visa", last4: "4242" },
      firstPaymentPence: quote.totalPence,
      monthlyPaymentPence: null,
      policies: [
        {
          reference: policy.reference,
          product: "car",
          coverLevel: "comprehensive",
          startsOn: "2026-12-01",
          endsOn: "2027-11-30",
          compulsoryExcessPence: 25_000,
          voluntaryExcessPence: 0,
          car: {
            make: "Volkswagen",
            model: "Golf",
            variant: "1.5 TSI Life",
            registration: "AB19 CDE",
          },
        },
      ],
    });
  });

  it("gives a monthly purchase its first payment and the instalment", async () => {
    const { actor, customer } = await signedUp();
    const { quote } = await makePurchase({
      customerId: customer.id,
      ratingVersionId: (await getActiveRatingTables("car")).id,
      plan: "monthly",
    });
    expect(await getPurchase(actor, { quoteId: quote.id })).toMatchObject({
      plan: "monthly",
      firstPaymentPence: 5_000,
      monthlyPaymentPence: 5_000,
    });
  });

  it("refuses a quote that isn't bought, and someone else's purchase", async () => {
    const a = await customerWithQuote();
    expect(await codeOf(() => getPurchase(a.actor, { quoteId: a.saved.quoteId }))).toBe(
      "NOT_FOUND",
    );
    const { actor: other } = await signedUp();
    const owner = await signedUp();
    const { quote } = await makePurchase({
      customerId: owner.customer.id,
      ratingVersionId: (await getActiveRatingTables("car")).id,
    });
    expect(await codeOf(() => getPurchase(other, { quoteId: quote.id }))).toBe("NOT_FOUND");
  });
});
