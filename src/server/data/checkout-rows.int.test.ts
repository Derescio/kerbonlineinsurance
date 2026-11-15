import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { checkoutSessions, customers, payments, policies, stripeEvents } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { truncateAll } from "#/test/db";
import { makeCustomer, makePayment, makePolicy, makeQuote } from "#/test/factories";

import {
  insertCheckoutSession,
  lockCheckoutBySessionId,
  markCheckout,
  markInstalment,
  openCheckoutFor,
  paymentsForSubscription,
  policiesForSubscription,
  recordStripeEvent,
  setPolicyStatus,
  setStripeCustomerId,
} from "./checkout-rows";

// The checkout and Stripe rows behind 5.6b (decisions 5 to 8, 13): the schema's own refusals and
// the helpers the checkout, the webhook and the daily lapse job share.

afterAll(closeDb);
beforeEach(truncateAll);

let n = 0;
async function session(
  quote: { id: string; customerId: string },
  overrides: Partial<typeof checkoutSessions.$inferInsert> = {},
) {
  n += 1;
  return insertCheckoutSession(getDb(), {
    quoteId: quote.id,
    customerId: quote.customerId,
    stripeSessionId: `cs_test_${n}`,
    plan: "annual",
    startsOn: "2026-12-01",
    detailsConfirmedAt: new Date(),
    coverAcknowledgedAt: new Date(),
    amountPence: 56_000,
    ...overrides,
  });
}

describe("the schema", () => {
  it("allows one open checkout session per quote, and any number once they're done", async () => {
    const { quote } = await makeQuote();
    const first = await session(quote);
    await expect(session(quote)).rejects.toThrow();

    await markCheckout(getDb(), first.id, "completed");
    await session(quote);
    await session(quote, { status: "expired" });
    await session(quote, { status: "completed" });
    const rows = await getDb().select().from(checkoutSessions);
    expect(rows.map((r) => r.status).sort()).toEqual(["completed", "completed", "expired", "open"]);
  });

  it("refuses lapsed_at on a policy that isn't lapsed", async () => {
    const policy = await makePolicy();
    await expect(
      getDb().update(policies).set({ lapsedAt: new Date() }).where(eq(policies.id, policy.id)),
    ).rejects.toThrow();
    await getDb()
      .update(policies)
      .set({ status: "lapsed", lapsedAt: new Date() })
      .where(eq(policies.id, policy.id));
  });

  it("keeps Stripe invoice and payment intent ids unique, with any number of nulls", async () => {
    const { quote } = await makeQuote();
    const row = (instalmentNumber: number, extra = {}) =>
      makePayment({
        customerId: quote.customerId,
        quoteId: quote.id,
        plan: "monthly",
        instalmentNumber,
        ...extra,
      });
    await row(1);
    await row(2);
    await row(3, { stripeInvoiceId: "in_1", stripePaymentIntentId: "pi_1" });
    await expect(row(4, { stripeInvoiceId: "in_1" })).rejects.toThrow();
    await expect(row(5, { stripePaymentIntentId: "pi_1" })).rejects.toThrow();
  });

  it("keeps a customer's Stripe id unique, with any number of nulls", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    await makeCustomer();
    await setStripeCustomerId(getDb(), a.id, "cus_1");
    await expect(setStripeCustomerId(getDb(), b.id, "cus_1")).rejects.toThrow();
  });

  it("refuses a checkout session for a quote that isn't the customer's", async () => {
    const { quote } = await makeQuote();
    const other = await makeCustomer();
    await expect(session({ id: quote.id, customerId: other.id })).rejects.toThrow();
  });
});

describe("the checkout helpers", () => {
  it("finds a quote's open session, and nothing once it's completed", async () => {
    const { quote } = await makeQuote();
    expect(await openCheckoutFor(getDb(), quote.id)).toBeNull();
    const created = await session(quote);
    expect(await openCheckoutFor(getDb(), quote.id)).toEqual({
      id: created.id,
      stripeSessionId: expect.stringMatching(/^cs_test_/),
    });
    await markCheckout(getDb(), created.id, "expired");
    expect(await openCheckoutFor(getDb(), quote.id)).toBeNull();
  });

  it("locks a session by its Stripe id, and returns null for an unknown one", async () => {
    const { quote } = await makeQuote();
    const created = await session(quote, { stripeSessionId: "cs_test_known" });
    const found = await withTx(getDb(), (tx) => lockCheckoutBySessionId(tx, "cs_test_known"));
    expect(found).toMatchObject({
      id: created.id,
      quoteId: quote.id,
      customerId: quote.customerId,
      plan: "annual",
      status: "open",
      amountPence: 56_000,
    });
    expect(await withTx(getDb(), (tx) => lockCheckoutBySessionId(tx, "cs_test_nope"))).toBeNull();
  });

  it("marks a session, stamping fulfilled_at when it completes", async () => {
    const { quote } = await makeQuote();
    const created = await session(quote);
    const at = new Date("2026-11-10T10:00:00Z");
    await markCheckout(getDb(), created.id, "completed", at);
    const [row] = await getDb().select().from(checkoutSessions);
    expect(row).toMatchObject({ status: "completed", fulfilledAt: at });
    await markCheckout(getDb(), created.id, "refunded");
    const [after] = await getDb().select().from(checkoutSessions);
    expect(after).toMatchObject({ status: "refunded", fulfilledAt: at });
  });

  it("records a Stripe event once: true, then false", async () => {
    const at = new Date("2026-11-10T10:00:00Z");
    expect(await recordStripeEvent(getDb(), "evt_1", "invoice.paid", at)).toBe(true);
    expect(await recordStripeEvent(getDb(), "evt_1", "invoice.paid", at)).toBe(false);
    expect(await recordStripeEvent(getDb(), "evt_2", "invoice.paid", at)).toBe(true);
    expect(await getDb().select().from(stripeEvents)).toHaveLength(2);
  });

  it("sets a customer's Stripe id", async () => {
    const customer = await makeCustomer();
    await setStripeCustomerId(getDb(), customer.id, "cus_abc");
    const [row] = await getDb().select().from(customers).where(eq(customers.id, customer.id));
    expect(row?.stripeCustomerId).toBe("cus_abc");
  });
});

describe("the subscription lookups", () => {
  async function monthly(subscriptionId: string) {
    const { quote, items } = await makeQuote({ products: ["car", "home"] });
    const base = { customerId: quote.customerId, quoteId: quote.id, plan: "monthly" } as const;
    const first = await makePayment({
      ...base,
      instalmentNumber: 1,
      stripeSubscriptionId: subscriptionId,
    });
    const second = await makePayment({
      ...base,
      instalmentNumber: 2,
      status: "scheduled",
      paidAt: null,
      stripeSubscriptionId: subscriptionId,
    });
    const owned = [];
    for (const { item } of items) {
      owned.push(
        await makePolicy({
          customerId: quote.customerId,
          quoteId: quote.id,
          quoteItemId: item.id,
          product: item.product as "car" | "home",
        }),
      );
    }
    return { quote, first, second, owned };
  }

  it("finds a subscription's instalments in order, and its quote's policies", async () => {
    const a = await monthly("sub_a");
    await monthly("sub_b");
    await makePayment();

    const rows = await paymentsForSubscription(getDb(), "sub_a");
    expect(rows.map((r) => r.id)).toEqual([a.first.id, a.second.id]);
    const found = await policiesForSubscription(getDb(), "sub_a");
    expect(found.map((p) => p.id).sort()).toEqual(a.owned.map((p) => p.id).sort());
    expect(await paymentsForSubscription(getDb(), "sub_none")).toEqual([]);
    expect(await policiesForSubscription(getDb(), "sub_none")).toEqual([]);
  });

  it("marks an instalment paid or failed", async () => {
    const { second } = await monthly("sub_a");
    const paidAt = new Date("2027-01-01T09:00:00Z");
    await markInstalment(getDb(), second.id, {
      status: "succeeded",
      paidAt,
      stripeInvoiceId: "in_2",
      stripePaymentIntentId: "pi_2",
    });
    const [row] = await getDb().select().from(payments).where(eq(payments.id, second.id));
    expect(row).toMatchObject({
      status: "succeeded",
      paidAt,
      stripeInvoiceId: "in_2",
      stripePaymentIntentId: "pi_2",
    });
    await markInstalment(getDb(), second.id, { status: "failed", paidAt: null });
    const [failed] = await getDb().select().from(payments).where(eq(payments.id, second.id));
    expect(failed).toMatchObject({ status: "failed", paidAt: null, stripeInvoiceId: "in_2" });
  });

  it("lapses, resumes and cancels a policy", async () => {
    const policy = await makePolicy();
    const at = new Date("2027-02-01T03:00:00Z");
    const read = async () =>
      (await getDb().select().from(policies).where(eq(policies.id, policy.id)))[0]!;

    await setPolicyStatus(getDb(), policy.id, "lapsed", { lapsedAt: at });
    expect(await read()).toMatchObject({ status: "lapsed", lapsedAt: at, cancelledAt: null });
    await setPolicyStatus(getDb(), policy.id, "active");
    expect(await read()).toMatchObject({ status: "active", lapsedAt: null, cancelledAt: null });
    await setPolicyStatus(getDb(), policy.id, "lapsed", { lapsedAt: at });
    await setPolicyStatus(getDb(), policy.id, "cancelled", { cancelledAt: at });
    expect(await read()).toMatchObject({ status: "cancelled", lapsedAt: null, cancelledAt: at });
  });
});
