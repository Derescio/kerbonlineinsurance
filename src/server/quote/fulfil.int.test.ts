import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  accountClosures,
  auditLog,
  checkoutSessions,
  jobs,
  payments,
  policies,
  quotes,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import type { JobDeps } from "#/server/jobs/types";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeUser } from "#/test/factories";
import { fakeStripe } from "#/test/stripe-fake";

import { startCheckout } from "./checkout";
import {
  billingTime,
  confirmCheckout,
  fulfilCheckout,
  stripeInstalmentDates,
  twelfthPeriodEnd,
  type FulfilOptions,
} from "./fulfil";
import { purchase } from "./purchase";
import { saveCarQuoteFor } from "./save";

// Fulfilling a Stripe checkout (5.6b, decision 6): the purchase rerun with the checkout row's
// answers and Stripe's card and ids, once per session whoever calls first, and a payment Kerb can't
// honour refunded. Stripe is the fake; each session is preset as Stripe would return it.

const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const ctx = { headers: new Headers() };
const stripe = fakeStripe();
const jobsDeps: JobDeps = { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true };
const opts = (extra: Partial<FulfilOptions> = {}): FulfilOptions => ({
  auditActor: null,
  now: NOW,
  stripe,
  jobs: jobsDeps,
  ...extra,
});

// 11 November 2026, 12:00 UTC: the first monthly period's start
const PERIOD_START = Math.floor(NOW.getTime() / 1000);

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

async function pricedCarQuote(): Promise<{ actor: Actor; quoteId: string }> {
  const user = await makeUser();
  const saved = await withTx(getDb(), async (tx) =>
    saveCarQuoteFor(tx, user.id, { journey: await golf(), now: NOW }),
  );
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, quoteId: saved.quoteId };
}

/** A checkout started for the quote; returns its row */
async function started(actor: Actor, quoteId: string, plan: "annual" | "monthly" = "annual") {
  const result = await startCheckout(
    actor,
    {
      input: {
        quoteId,
        plan,
        startsOn: STARTS_ON,
        detailsConfirmed: true,
        coverAcknowledged: true,
      },
      idempotencyKey: randomUUID(),
    },
    ctx,
    { stripe, testClocks: false, now: NOW },
  );
  if (!result.ok || result.data.status !== "ready") throw new Error("checkout not started");
  const [row] = await getDb()
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, result.data.checkoutId));
  return row!;
}

/** Stripe's completed in-full session, its payment intent and card expanded */
function paidAnnual(sessionId: string, amount: number, extra: Record<string, unknown> = {}) {
  stripe.set("checkout.sessions.retrieve", sessionId, {
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: amount,
    subscription: null,
    invoice: null,
    payment_intent: {
      id: `pi_for_${sessionId}`,
      object: "payment_intent",
      payment_method: {
        id: "pm_test_1",
        object: "payment_method",
        card: { brand: "visa", last4: "4242" },
      },
    },
    ...extra,
  });
}

/** Stripe's completed subscription session, the subscription and its card expanded */
function paidMonthly(
  sessionId: string,
  amount: number,
  unitAmount = amount,
  periodStart = PERIOD_START,
) {
  const subscriptionId = `sub_for_${sessionId}`;
  const invoiceId = `in_for_${sessionId}`;
  stripe.set("checkout.sessions.retrieve", sessionId, {
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    amount_total: amount,
    payment_intent: null,
    invoice: invoiceId,
    subscription: {
      id: subscriptionId,
      object: "subscription",
      status: "active",
      latest_invoice: invoiceId,
      default_payment_method: {
        id: "pm_test_2",
        object: "payment_method",
        card: { brand: "mastercard", last4: "4444" },
      },
      items: {
        object: "list",
        data: [
          {
            id: "si_test_1",
            current_period_start: periodStart,
            current_period_end: periodStart + 30 * 86_400,
            price: { unit_amount: unitAmount, recurring: { interval: "month" } },
          },
        ],
      },
    },
  });
  stripe.set("invoices.retrieve", invoiceId, {
    object: "invoice",
    parent: { subscription_details: { subscription: subscriptionId } },
    lines: {
      object: "list",
      data: [{ id: "il_1", period: { start: periodStart, end: periodStart } }],
    },
    payments: {
      object: "list",
      data: [{ payment: { type: "payment_intent", payment_intent: `pi_for_${invoiceId}` } }],
    },
  });
  return { subscriptionId, invoiceId, paymentIntentId: `pi_for_${invoiceId}` };
}

const countPolicies = async () => (await getDb().select().from(policies)).length;
const refundAudits = () =>
  getDb().select().from(auditLog).where(eq(auditLog.action, "payment.refunded"));
const refundEmails = async () =>
  (await getDb().select().from(jobs)).filter(
    (j) => (j.payload as { template?: string }).template === "payment_refunded",
  );
const rowOf = async (id: string) =>
  (await getDb().select().from(checkoutSessions).where(eq(checkoutSessions.id, id)))[0]!;

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

describe("fulfilCheckout: buying", () => {
  it("buys an annual quote: one policy, the payment taken, Stripe's card and payment intent", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toEqual({
      status: "fulfilled",
      quoteId,
    });

    expect(stripe.calls["checkout.sessions.retrieve"]![0]).toEqual([
      row.stripeSessionId,
      { expand: ["payment_intent.payment_method", "subscription.default_payment_method"] },
    ]);
    expect(await countPolicies()).toBe(1);
    const paid = await getDb().select().from(payments);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      status: "succeeded",
      amountPence: row.amountPence,
      stripePaymentIntentId: `pi_for_${row.stripeSessionId}`,
      stripeSubscriptionId: null,
      cardBrand: "Visa",
      cardLast4: "4242",
    });
    const after = await rowOf(row.id);
    expect(after.status).toBe("completed");
    expect(after.fulfilledAt).toEqual(NOW);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.status).toBe("accepted");
    // The answers the session was made for
    expect(quote!.detailsConfirmedAt).toEqual(row.detailsConfirmedAt);
    // An annual plan has no subscription to end
    expect(stripe.calls["subscriptions.update"]).toBeUndefined();
    expect(await refundAudits()).toHaveLength(0);
  });

  it("records the customer as the audit actor from the return page, and null from the webhook", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    await fulfilCheckout(row.stripeSessionId, opts({ auditActor: actor }));
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "policy.purchased"));
    expect(entry!.actorUserId).toBe(actor.userId);
  });

  it("buys monthly: 12 rows on Stripe's billing dates, the first paid, and the term ended after 12 periods", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const ids = paidMonthly(row.stripeSessionId, row.amountPence);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toEqual({
      status: "fulfilled",
      quoteId,
    });

    const rows = await getDb().select().from(payments).orderBy(asc(payments.instalmentNumber));
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.dueOn)).toEqual([
      "2026-11-11",
      "2026-12-11",
      "2027-01-11",
      "2027-02-11",
      "2027-03-11",
      "2027-04-11",
      "2027-05-11",
      "2027-06-11",
      "2027-07-11",
      "2027-08-11",
      "2027-09-11",
      "2027-10-11",
    ]);
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      amountPence: row.amountPence,
      stripeSubscriptionId: ids.subscriptionId,
      stripeInvoiceId: ids.invoiceId,
      stripePaymentIntentId: ids.paymentIntentId,
      cardBrand: "Mastercard",
      cardLast4: "4444",
    });
    expect(rows.slice(1).every((r) => r.status === "scheduled")).toBe(true);
    expect(rows.every((r) => r.stripeSubscriptionId === ids.subscriptionId)).toBe(true);

    // The end of the 12th period: 11 November 2027, 12:00 UTC
    expect(stripe.calls["subscriptions.update"]).toEqual([
      [
        ids.subscriptionId,
        {
          cancel_at: Math.floor(Date.parse("2027-11-11T12:00:00Z") / 1000),
          proration_behavior: "none",
        },
      ],
    ]);
  });

  it("dates each instalment by the London date of Stripe's UTC billing time", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London (BST)
    const anchor = Math.floor(Date.parse("2026-06-30T23:30:00Z") / 1000);
    expect(new Date(billingTime(anchor, 8) * 1000).toISOString()).toBe("2027-02-28T23:30:00.000Z");
    expect(stripeInstalmentDates(anchor)).toEqual([
      "2026-07-01", // BST: the next London day
      "2026-07-31",
      "2026-08-31",
      "2026-10-01",
      "2026-10-30", // GMT: the same day as Stripe's
      "2026-11-30",
      "2026-12-30",
      "2027-01-30",
      "2027-02-28", // the 30th clamped to February's end
      "2027-03-31", // BST again from 28 March
      "2027-05-01",
      "2027-05-31",
    ]);
    // The 31st clamps to each short month and comes back
    const jan31 = Math.floor(Date.parse("2027-01-31T10:00:00Z") / 1000);
    expect(stripeInstalmentDates(jan31).slice(0, 4)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("writes Stripe's billing dates on the rows for a summer-evening purchase", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const anchor = Math.floor(Date.parse("2026-06-30T23:30:00Z") / 1000);
    const ids = paidMonthly(row.stripeSessionId, row.amountPence, row.amountPence, anchor);

    await fulfilCheckout(row.stripeSessionId, opts());

    const rows = await getDb().select().from(payments).orderBy(asc(payments.instalmentNumber));
    expect(rows.map((r) => r.dueOn)).toEqual(stripeInstalmentDates(anchor));
    expect(rows[4]!.dueOn).toBe("2026-10-30");
    expect(stripe.calls["subscriptions.update"]![0]).toEqual([
      ids.subscriptionId,
      {
        cancel_at: Math.floor(Date.parse("2027-06-30T23:30:00Z") / 1000),
        proration_behavior: "none",
      },
    ]);
  });

  it("works out the 12th period's end with the day clamped to the month", () => {
    const jan31 = Math.floor(Date.parse("2027-01-31T09:30:00Z") / 1000);
    expect(twelfthPeriodEnd(jan31)).toBe(Math.floor(Date.parse("2028-01-31T09:30:00Z") / 1000));
    const leapDay = Math.floor(Date.parse("2028-02-29T00:00:00Z") / 1000);
    expect(twelfthPeriodEnd(leapDay)).toBe(Math.floor(Date.parse("2029-02-28T00:00:00Z") / 1000));
  });

  it("from the return page, keeps the purchase when ending the subscription fails, and logs it", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    paidMonthly(row.stripeSessionId, row.amountPence);
    stripe.fail("subscriptions.update");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "fulfilled",
    });

    expect(await countPolicies()).toBe(1);
    expect((await rowOf(row.id)).status).toBe("completed");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("cancel_at"), {
      name: "Error",
    });
    logged.mockRestore();
  });

  it("for the webhook, keeps the purchase but throws when ending the subscription fails, so Stripe retries", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const ids = paidMonthly(row.stripeSessionId, row.amountPence);
    stripe.failOnce("subscriptions.update");

    await expect(
      fulfilCheckout(row.stripeSessionId, opts({ cancelAtFailure: "throw" })),
    ).rejects.toThrow("Stripe is down");
    // The purchase committed before cancel_at was set
    expect(await countPolicies()).toBe(1);
    expect((await rowOf(row.id)).status).toBe("completed");

    // Stripe's retry: already fulfilled, and cancel_at set this time
    await expect(
      fulfilCheckout(row.stripeSessionId, opts({ cancelAtFailure: "throw" })),
    ).resolves.toEqual({ status: "already", quoteId });
    expect(stripe.calls["subscriptions.update"]!.map((c) => c[0])).toEqual([
      ids.subscriptionId,
      ids.subscriptionId,
    ]);
    expect(await countPolicies()).toBe(1);
  });

  it("uses the session's own invoice and its period, though the subscription has moved on to month 2", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const ids = paidMonthly(row.stripeSessionId, row.amountPence);
    // A late fulfilment: Stripe's subscription now points at month 2's invoice and period
    const month2 = billingTime(PERIOD_START, 1);
    const session = await stripe.checkout.sessions.retrieve(row.stripeSessionId);
    const subscription = session.subscription as unknown as Record<string, unknown>;
    stripe.set("checkout.sessions.retrieve", row.stripeSessionId, {
      ...session,
      subscription: {
        ...subscription,
        latest_invoice: "in_month_2",
        items: {
          object: "list",
          data: [
            {
              id: "si_test_1",
              current_period_start: month2,
              current_period_end: billingTime(PERIOD_START, 2),
              price: { unit_amount: row.amountPence, recurring: { interval: "month" } },
            },
          ],
        },
      },
    });
    stripe.calls["checkout.sessions.retrieve"]!.splice(0);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "fulfilled",
    });
    const rows = await getDb().select().from(payments).orderBy(asc(payments.instalmentNumber));
    expect(rows[0]).toMatchObject({
      stripeInvoiceId: ids.invoiceId,
      stripePaymentIntentId: ids.paymentIntentId,
      dueOn: "2026-11-11",
    });
    expect(rows.map((r) => r.dueOn)).toEqual(stripeInstalmentDates(PERIOD_START));
    expect(stripe.calls["subscriptions.update"]![0]![1]).toMatchObject({
      cancel_at: twelfthPeriodEnd(PERIOD_START),
    });
  });

  it("reads the card brand as people know it", async () => {
    const cases: [string, string][] = [
      ["amex", "American Express"],
      ["jcb", "JCB"],
      ["unionpay", "UnionPay"],
      ["cartes_bancaires", "Cartes Bancaires"],
      ["diners", "Diners Club"],
      ["discover", "Discover"],
      ["eftpos_au", "eftpos Australia"],
      ["interac", "Interac"],
      ["some_new_brand", "Some New Brand"],
    ];
    for (const [brand, shown] of cases) {
      await truncateExcept(REFERENCE_TABLES);
      const { actor, quoteId } = await pricedCarQuote();
      const row = await started(actor, quoteId);
      paidAnnual(row.stripeSessionId, row.amountPence, {
        payment_intent: {
          id: `pi_for_${row.stripeSessionId}`,
          object: "payment_intent",
          payment_method: { id: "pm_x", object: "payment_method", card: { brand, last4: "1117" } },
        },
      });
      await fulfilCheckout(row.stripeSessionId, opts());
      const [paid] = await getDb().select().from(payments);
      expect([brand, paid!.cardBrand, paid!.cardLast4]).toEqual([brand, shown, "1117"]);
    }
  });

  it("throws, writing nothing, when Stripe gives no card (never a made-up last four)", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence, {
      payment_intent: {
        id: `pi_for_${row.stripeSessionId}`,
        object: "payment_intent",
        payment_method: { id: "pm_x", object: "payment_method", card: null },
      },
    });

    await expect(fulfilCheckout(row.stripeSessionId, opts())).rejects.toThrow(/card/);
    expect(await countPolicies()).toBe(0);
    expect(await getDb().select().from(payments)).toHaveLength(0);
    expect((await rowOf(row.id)).status).toBe("open");
  });

  it("honours an expired quote when the checkout started before it expired", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    const validUntil = new Date(row.createdAt.getTime() + 60_000);
    await getDb().update(quotes).set({ validUntil }).where(eq(quotes.id, quoteId));

    const later = new Date(validUntil.getTime() + 3_600_000);
    await expect(fulfilCheckout(row.stripeSessionId, opts({ now: later }))).resolves.toMatchObject({
      status: "fulfilled",
    });
    expect(await countPolicies()).toBe(1);
  });

  it("refunds an expired quote when the checkout started after it expired", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    const validUntil = new Date(row.createdAt.getTime() - 60_000);
    await getDb().update(quotes).set({ validUntil }).where(eq(quotes.id, quoteId));

    const later = new Date(row.createdAt.getTime() + 3_600_000);
    await expect(fulfilCheckout(row.stripeSessionId, opts({ now: later }))).resolves.toMatchObject({
      status: "refunded",
    });
    expect(await countPolicies()).toBe(0);
    const [email] = await refundEmails();
    expect((email!.payload as { params: Record<string, string> }).params.reason).toBe(
      "Your quote had expired before you started paying.",
    );
  });
});

describe("fulfilCheckout: once per session", () => {
  it("does nothing the second time and says so", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);

    await fulfilCheckout(row.stripeSessionId, opts());
    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toEqual({
      status: "already",
      quoteId,
    });
    expect(await countPolicies()).toBe(1);
    expect(await getDb().select().from(payments)).toHaveLength(1);
    expect(stripe.calls["refunds.create"]).toBeUndefined();
  });

  it("makes one policy when the return page and the webhook fulfil at the same moment", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    paidMonthly(row.stripeSessionId, row.amountPence);

    const results = await Promise.all([
      fulfilCheckout(row.stripeSessionId, opts({ auditActor: actor })),
      fulfilCheckout(row.stripeSessionId, opts()),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["already", "fulfilled"]);
    expect(await countPolicies()).toBe(1);
    expect(await getDb().select().from(payments)).toHaveLength(12);
    expect(stripe.calls["refunds.create"]).toBeUndefined();
  });

  it("is pending while Stripe hasn't taken the payment, writing nothing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence, { payment_status: "unpaid" });

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toEqual({
      status: "pending",
    });
    expect(await countPolicies()).toBe(0);
    expect(await getDb().select().from(payments)).toHaveLength(0);
    expect((await rowOf(row.id)).status).toBe("open");
  });

  it("is unknown for a session Kerb has no row for", async () => {
    paidAnnual("cs_test_elsewhere", 10_000);
    await expect(fulfilCheckout("cs_test_elsewhere", opts())).resolves.toEqual({
      status: "unknown",
    });
  });
});

describe("fulfilCheckout: refunding what can't be honoured", () => {
  async function expectRefunded(rowId: string) {
    expect((await rowOf(rowId)).status).toBe("refunded");
    expect(await countPolicies()).toBe(0);
    const audits = await refundAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "checkout_session",
      entityId: rowId,
      actorUserId: null,
    });
    const emails = await refundEmails();
    expect(emails).toHaveLength(1);
    return emails[0]!.payload as { to: string; params: Record<string, string> };
  }

  it("refunds a monthly checkout for a quote bought through another session, cancelling first", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const ids = paidMonthly(row.stripeSessionId, row.amountPence);
    // Bought another way while this session was paid
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
        stripe: { paymentIntentId: "pi_test_other" },
        auditActor: null,
        now: NOW,
      }),
    );
    const before = await countPolicies();

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toEqual({
      status: "refunded",
      quoteId,
    });

    expect(stripe.calls["subscriptions.cancel"]).toEqual([
      [ids.subscriptionId, { prorate: false, invoice_now: false }],
    ]);
    expect(stripe.calls["refunds.create"]).toEqual([
      [
        { payment_intent: ids.paymentIntentId },
        { idempotencyKey: `kerb-refund-${row.stripeSessionId}` },
      ],
    ]);
    expect(stripe.calls["subscriptions.update"]).toBeUndefined();
    expect(await countPolicies()).toBe(before);
    expect((await rowOf(row.id)).status).toBe("refunded");
    const audits = await refundAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityType: "checkout_session", entityId: row.id });
    const emails = await refundEmails();
    expect(emails).toHaveLength(1);
    expect((emails[0]!.payload as { params: Record<string, string> }).params.reason).toBe(
      "You’d already bought this quote.",
    );

    // A second call doesn't refund again
    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "refunded",
    });
    expect(stripe.calls["refunds.create"]).toHaveLength(1);
    expect(await refundAudits()).toHaveLength(1);
  });

  it("refunds an amount that doesn't match what the session was made for", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence + 1);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "refunded",
    });

    expect(stripe.calls["refunds.create"]).toEqual([
      [
        { payment_intent: `pi_for_${row.stripeSessionId}` },
        { idempotencyKey: `kerb-refund-${row.stripeSessionId}` },
      ],
    ]);
    expect(stripe.calls["subscriptions.cancel"]).toBeUndefined();
    const email = await expectRefunded(row.id);
    expect(email.params.reason).toBe("The amount taken didn’t match your quote.");
    expect(email.params.url).toMatch(/\/account$/);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.status).toBe("priced");
  });

  it("refunds a monthly checkout whose subscription price doesn't match", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    const ids = paidMonthly(row.stripeSessionId, row.amountPence, row.amountPence - 1);

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "refunded",
    });
    expect(stripe.calls["subscriptions.cancel"]).toHaveLength(1);
    expect(stripe.calls["refunds.create"]![0]![0]).toEqual({
      payment_intent: ids.paymentIntentId,
    });
    await expectRefunded(row.id);
  });

  it("refunds a customer whose account is closing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    await getDb()
      .insert(accountClosures)
      .values({
        userId: actor.userId,
        requestedAt: NOW,
        closesAt: new Date(NOW.getTime() + 30 * 86_400_000),
      });

    await expect(fulfilCheckout(row.stripeSessionId, opts())).resolves.toMatchObject({
      status: "refunded",
    });
    const email = await expectRefunded(row.id);
    expect(email.params.reason).toBe("Your account is closing, so we can’t sell you a policy.");
  });
});

describe("confirmCheckout (the return page)", () => {
  it("fulfils the signed-in customer's own session with them as the actor", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    const { auditActor: _, ...rest } = opts();
    await expect(
      confirmCheckout(actor, { quoteId, sessionId: row.stripeSessionId }, rest),
    ).resolves.toEqual({ status: "fulfilled" });
    expect(await countPolicies()).toBe(1);
  });

  it("still answers fulfilled when setting cancel_at fails, and logs it (the webhook retries it)", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId, "monthly");
    paidMonthly(row.stripeSessionId, row.amountPence);
    stripe.fail("subscriptions.update");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { auditActor: _, ...rest } = opts();
    await expect(
      confirmCheckout(actor, { quoteId, sessionId: row.stripeSessionId }, rest),
    ).resolves.toEqual({ status: "fulfilled" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("cancel_at"), { name: "Error" });
    logged.mockRestore();
  });

  it("is not found for another customer's quote, and fulfils nothing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const row = await started(actor, quoteId);
    paidAnnual(row.stripeSessionId, row.amountPence);
    const other = await pricedCarQuote();
    const { auditActor: _, ...rest } = opts();

    for (const input of [
      { quoteId, sessionId: row.stripeSessionId },
      { quoteId: other.quoteId, sessionId: row.stripeSessionId },
      { quoteId: "not-a-uuid", sessionId: row.stripeSessionId },
    ]) {
      const error = await confirmCheckout(other.actor, input, rest).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthzError);
      expect((error as AuthzError).code).toBe("NOT_FOUND");
    }
    // Signed out
    await expect(
      confirmCheckout(null, { quoteId, sessionId: row.stripeSessionId }, rest),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(stripe.calls["checkout.sessions.retrieve"]).toBeUndefined();
    expect(await countPolicies()).toBe(0);
  });
});
