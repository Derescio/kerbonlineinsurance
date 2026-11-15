import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { monthlyPayment } from "#/features/rating/money";
import { Tables } from "#/features/rating/tables";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { RateLimitError } from "#/server/auth/errors";
import {
  clearReferenceCaches,
  getActiveRatingTables,
  getCatalogue,
  upsertReferenceData,
} from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  accountClosures,
  checkoutSessions,
  customers,
  policies,
  quoteItems,
  quotes,
  vehicles,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeUser } from "#/test/factories";
import { fakeStripe } from "#/test/stripe-fake";

import { startCheckout, type CheckoutDeps } from "./checkout";
import { purchase } from "./purchase";
import { saveCarQuoteFor } from "./save";

// Starting a Stripe checkout (5.6b, decision 5): the 5.6 checks, then the Stripe customer, the
// previous open session expired, a new embedded session, and a checkout_sessions row with the
// answers it was made for. Nothing is written to quotes or policies. Stripe is the fake.

const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const ctx = { headers: new Headers() };
const stripe = fakeStripe();
const deps: CheckoutDeps = { stripe, testClocks: false, now: NOW };

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

async function pricedCarQuote(
  journey?: Journey,
  userId?: string,
): Promise<{ actor: Actor; quoteId: string; email: string }> {
  const user = userId ? { id: userId, email: "" } : await makeUser();
  const answers = journey ?? (await golf());
  const saved = await withTx(getDb(), (tx) =>
    saveCarQuoteFor(tx, user.id, { journey: answers, now: NOW }),
  );
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, quoteId: saved.quoteId, email: user.email };
}

const start = (
  actor: Actor,
  quoteId: string,
  overrides: Record<string, unknown> = {},
  key: string = randomUUID(),
  using: CheckoutDeps = deps,
) =>
  startCheckout(
    actor,
    {
      input: {
        quoteId,
        plan: "annual",
        startsOn: STARTS_ON,
        detailsConfirmed: true,
        coverAcknowledged: true,
        ...overrides,
      },
      idempotencyKey: key,
    },
    ctx,
    using,
  );

const sessionRows = () => getDb().select().from(checkoutSessions);
const created = () => stripe.calls["checkout.sessions.create"] ?? [];

beforeAll(async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
  stripe.reset();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("startCheckout: the 5.6 refusals create no session", () => {
  async function refusedWith(actor: Actor, quoteId: string, message: string) {
    await expect(start(actor, quoteId)).resolves.toMatchObject({ ok: false, error: { message } });
    expect(created()).toHaveLength(0);
    expect(await sessionRows()).toHaveLength(0);
  }

  it("refuses an account that is closing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .insert(accountClosures)
      .values({
        userId: actor.userId,
        requestedAt: NOW,
        closesAt: new Date(NOW.getTime() + 30 * 86_400_000),
      });
    await refusedWith(actor, quoteId, "Your account is closing, so you can’t buy a policy.");
  });

  it("refuses a quote already bought", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await withTx(getDb(), (tx) =>
      purchase(tx, {
        userId: actor.userId,
        customerId: actor.customerId!,
        quoteId,
        plan: "annual",
        startsOn: STARTS_ON,
        detailsConfirmedAt: NOW,
        coverAcknowledgedAt: NOW,
        card: { brand: "Visa", last4: "4242" },
        stripe: { paymentIntentId: "pi_test_1" },
        auditActor: actor,
        now: NOW,
      }),
    );
    await refusedWith(actor, quoteId, "You’ve already bought this quote.");
  });

  it("refuses an expired quote", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(quotes)
      .set({ validUntil: new Date(NOW.getTime() - 1000) })
      .where(eq(quotes.id, quoteId));
    await refusedWith(
      actor,
      quoteId,
      "This quote has expired. Get a new quote to see today’s price.",
    );
  });

  it("refuses a quote that isn't priced", async () => {
    const journey = await golf();
    journey.claims!.incidents = [1, 2, 3].map((n) => ({
      ...journey.claims!.incidents[0]!,
      id: `i${n}`,
    }));
    const { actor, quoteId } = await pricedCarQuote(journey);
    await refusedWith(actor, quoteId, "This quote can’t be bought online.");
  });

  it("checks the start date and both boxes", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await expect(start(actor, quoteId, { startsOn: "2026-12-12" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fields: { startsOn: "Choose a start date from today up to 30 days ahead." },
      },
    });
    // Today is the earliest start
    await expect(start(actor, quoteId, { startsOn: "2026-11-10" })).resolves.toMatchObject({
      ok: false,
      error: { fields: { startsOn: expect.any(String) } },
    });
    await expect(
      start(actor, quoteId, { detailsConfirmed: false, coverAcknowledged: false }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        fields: { detailsConfirmed: expect.any(String), coverAcknowledged: expect.any(String) },
      },
    });
    expect(created()).toHaveLength(0);
    expect(await sessionRows()).toHaveLength(0);
  });

  it("treats another customer's quote as not found", async () => {
    const { quoteId } = await pricedCarQuote();
    const { actor: other } = await pricedCarQuote();
    await expect(start(other, quoteId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(created()).toHaveLength(0);
  });
});

describe("startCheckout: a session", () => {
  it("records one open row with both confirmation times and the amount, and returns the secret", async () => {
    const { actor, quoteId, email } = await pricedCarQuote();
    const result = await start(actor, quoteId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(rows[0]).toMatchObject({
      id: result.data.checkoutId,
      quoteId,
      customerId: actor.customerId,
      stripeSessionId: "cs_test_1",
      plan: "annual",
      startsOn: STARTS_ON,
      detailsConfirmedAt: NOW,
      coverAcknowledgedAt: NOW,
      amountPence: quote!.totalPence,
      status: "open",
      fulfilledAt: null,
    });
    expect(result.data).toEqual({ clientSecret: "cs_test_1_secret", checkoutId: rows[0]!.id });

    // The session Stripe was asked for: the customer, the amount, the line and the environment
    expect(created()).toHaveLength(1);
    const [params] = created()[0]! as [Record<string, unknown>];
    expect(params).toMatchObject({
      mode: "payment",
      ui_mode: "embedded",
      customer: "cus_test_1",
      metadata: { kerb_env: "local", quote_id: quoteId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: quote!.totalPence,
            product_data: { name: "Kerb car insurance, Comprehensive, Volkswagen Golf" },
          },
        },
      ],
    });
    expect(String(params.return_url)).toBe(
      `http://localhost:3000/quote/covered/${quoteId}?session_id={CHECKOUT_SESSION_ID}`,
    );
    const [customerParams] = stripe.calls["customers.create"]![0]! as [Record<string, unknown>];
    expect(customerParams).toMatchObject({
      name: "Alex Morgan",
      email,
      metadata: { kerb_env: "local" },
    });

    // Nothing bought yet
    expect(quote!.status).toBe("priced");
    expect(quote!.detailsConfirmedAt).toBeNull();
    expect(await getDb().select().from(policies)).toHaveLength(0);
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    expect(item!.startDate).toBe("2026-11-12");
  });

  it("names the car by its registration when it has one", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    await getOwnerDb()
      .update(vehicles)
      .set({ registration: "KR24 BXL" })
      .where(eq(vehicles.quoteItemId, item!.id));
    expect((await start(actor, quoteId)).ok).toBe(true);
    const [params] = created()[0]! as [
      { line_items: { price_data: { product_data: { name: string } } }[] },
    ];
    expect(params.line_items[0]!.price_data.product_data.name).toBe(
      "Kerb car insurance, Comprehensive, KR24 BXL",
    );
  });

  it("expires the previous session on a second start, leaving one open row", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const first = await start(actor, quoteId);
    const second = await start(actor, quoteId);
    expect(first.ok && second.ok).toBe(true);
    expect(stripe.calls["checkout.sessions.expire"]).toEqual([["cs_test_1", {}]]);

    const rows = await sessionRows();
    const byId = rows.map((r) => [r.stripeSessionId, r.status]);
    byId.sort(([a], [b]) => a!.localeCompare(b!));
    expect(byId).toEqual([
      ["cs_test_1", "expired"],
      ["cs_test_2", "open"],
    ]);
    expect(second.ok && second.data.clientSecret).toBe("cs_test_2_secret");
    // The Stripe customer is made once
    expect(stripe.calls["customers.create"]).toHaveLength(1);
  });

  it("replays the same idempotency key without a second session", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const key = randomUUID();
    const first = await start(actor, quoteId, {}, key);
    const second = await start(actor, quoteId, {}, key);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(created()).toHaveLength(1);
    expect(await sessionRows()).toHaveLength(1);
  });

  it("writes nothing when Stripe fails, so the session is never recorded", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    stripe.failOnce("checkout.sessions.create");
    await expect(start(actor, quoteId)).rejects.toThrow("Stripe is down");
    expect(await sessionRows()).toHaveLength(0);
    const [customer] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, actor.customerId!));
    expect(customer!.stripeCustomerId).toBeNull();
  });

  it("is limited to 10 starts an hour", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    for (let i = 0; i < 10; i++) expect((await start(actor, quoteId)).ok).toBe(true);
    await expect(start(actor, quoteId)).rejects.toBeInstanceOf(RateLimitError);
    expect(created()).toHaveLength(10);
  });
});

describe("startCheckout: monthly and the Stripe customer", () => {
  it("creates the Stripe customer once, stores it, and reuses it for the next checkout", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const result = await start(actor, quoteId, { plan: "monthly" });
    expect(result.ok).toBe(true);

    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    const tables = await getActiveRatingTables("car");
    expect(item!.ratingVersionId).toBe(tables.id);
    const each = monthlyPayment(
      quote!.totalPence,
      new Tables(tables).param("monthly_credit_charge_rate"),
    );
    const [row] = await sessionRows();
    expect(row).toMatchObject({ plan: "monthly", amountPence: each, status: "open" });

    const [params] = created()[0]! as [Record<string, unknown>];
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_test_1",
      subscription_data: { metadata: { kerb_env: "local", quote_id: quoteId } },
      line_items: [{ price_data: { unit_amount: each, recurring: { interval: "month" } } }],
    });
    const [customer] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, actor.customerId!));
    expect(customer!.stripeCustomerId).toBe("cus_test_1");

    // A second quote of theirs: the same Stripe customer, not a new one
    const second = await pricedCarQuote(undefined, actor.userId);
    expect((await start(second.actor, second.quoteId, { plan: "monthly" })).ok).toBe(true);
    expect(stripe.calls["customers.create"]).toHaveLength(1);
    expect((created()[1]![0] as { customer: string }).customer).toBe("cus_test_1");
    // Without test clocks, Stripe isn't asked about the customer it already has
    expect(stripe.calls["customers.retrieve"]).toBeUndefined();
  });

  it("with test clocks, replaces a customer that has no clock with a clock-backed one", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(customers)
      .set({ stripeCustomerId: "cus_old" })
      .where(eq(customers.id, actor.customerId!));
    stripe.set("customers.retrieve", "cus_old", { object: "customer", test_clock: null });

    const result = await start(actor, quoteId, { plan: "monthly" }, randomUUID(), {
      ...deps,
      testClocks: true,
    });
    expect(result.ok).toBe(true);
    expect(stripe.calls["customers.retrieve"]![0]![0]).toBe("cus_old");
    expect(stripe.calls["testHelpers.testClocks.create"]).toHaveLength(1);
    const [clockParams] = stripe.calls["testHelpers.testClocks.create"]![0]! as [
      { frozen_time: number },
    ];
    expect(clockParams.frozen_time).toBe(Math.floor(NOW.getTime() / 1000));
    const [customerParams] = stripe.calls["customers.create"]![0]! as [Record<string, unknown>];
    expect(customerParams).toMatchObject({
      test_clock: "clock_test_1",
      metadata: { kerb_env: "local" },
    });
    const [customer] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, actor.customerId!));
    expect(customer!.stripeCustomerId).toBe("cus_test_1");
    expect((created()[0]![0] as { customer: string }).customer).toBe("cus_test_1");
  });

  it("with test clocks, keeps a customer already on a clock", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(customers)
      .set({ stripeCustomerId: "cus_clocked" })
      .where(eq(customers.id, actor.customerId!));
    stripe.set("customers.retrieve", "cus_clocked", {
      object: "customer",
      test_clock: "clock_old",
    });
    const result = await start(actor, quoteId, { plan: "monthly" }, randomUUID(), {
      ...deps,
      testClocks: true,
    });
    expect(result.ok).toBe(true);
    expect(stripe.calls["customers.create"]).toBeUndefined();
    expect(stripe.calls["testHelpers.testClocks.create"]).toBeUndefined();
    expect((created()[0]![0] as { customer: string }).customer).toBe("cus_clocked");
  });
});
