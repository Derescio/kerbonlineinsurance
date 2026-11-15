import { asc, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { authUrls } from "#/server/auth/origins";
import { clearReferenceCaches, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  checkoutSessions,
  jobs,
  payments,
  policies,
  stripeEvents,
  users,
} from "#/server/db/schema";
import type { JobDeps } from "#/server/jobs/types";
import { billingTime } from "#/server/quote/fulfil";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { fakeStripe } from "#/test/stripe-fake";
import {
  paidMonthlySession,
  presetInvoice,
  pricedCarQuote,
  sessionObject,
  signedRequest,
  startedCheckout,
  stripeEvent,
  TEST_WEBHOOK_SECRET,
} from "#/test/stripe-events";

import { handleStripeWebhook } from "./webhook";

// The Stripe webhook (5.6b, decisions 2, 7 and 8): verified against the raw body, acted on once
// per event id, only for this environment's objects, and a throw answered 500 so Stripe retries.
// Payloads are signed with the real library and checked by the real constructEvent; every Stripe
// call goes to the fake.

const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
// The first monthly period starts at NOW; month 2 is Stripe's next billing time
const PERIOD_START = Math.floor(NOW.getTime() / 1000);
const MONTH_2 = billingTime(PERIOD_START, 1);
const PAID_AT = MONTH_2 + 3600;

const stripe = fakeStripe();
const jobsDeps: JobDeps = { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true };
const deps = { stripe, webhookSecret: TEST_WEBHOOK_SECRET, now: NOW, jobs: jobsDeps };
const deliver = (event: Record<string, unknown>) => handleStripeWebhook(signedRequest(event), deps);

const recordedEvents = () => getDb().select().from(stripeEvents);
const instalments = (subscriptionId: string) =>
  getDb()
    .select()
    .from(payments)
    .where(eq(payments.stripeSubscriptionId, subscriptionId))
    .orderBy(asc(payments.instalmentNumber));
const failedEmails = async () =>
  (await getDb().select().from(jobs)).filter(
    (j) => (j.payload as { template?: string }).template === "payment_failed",
  );

/** A monthly checkout started and paid at the fake Stripe, not yet fulfilled */
async function paidMonthlyCheckout() {
  const { actor, quoteId } = await pricedCarQuote(NOW);
  const row = await startedCheckout(stripe, actor, quoteId, { now: NOW, startsOn: STARTS_ON });
  const ids = paidMonthlySession(stripe, row.stripeSessionId, row.amountPence, PERIOD_START);
  return { actor, quoteId, row, ...ids };
}

/** A monthly plan bought through the webhook: 12 rows, the first paid */
async function boughtMonthly() {
  const bought = await paidMonthlyCheckout();
  const response = await deliver(
    stripeEvent("checkout.session.completed", sessionObject(bought.row.stripeSessionId)),
  );
  expect(response.status).toBe(200);
  return bought;
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("VERCEL_TARGET_ENV", "");
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
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("handleStripeWebhook: the request", () => {
  it("refuses a bad signature with 400, recording nothing", async () => {
    const event = stripeEvent("checkout.session.completed", sessionObject("cs_test_x"));
    const forged = await handleStripeWebhook(signedRequest(event, "whsec_someone_else"), deps);
    expect(forged.status).toBe(400);

    const unsigned = await handleStripeWebhook(
      new Request("http://localhost:3000/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(event),
      }),
      deps,
    );
    expect(unsigned.status).toBe(400);
    expect(await recordedEvents()).toHaveLength(0);
    expect(stripe.calls["checkout.sessions.retrieve"]).toBeUndefined();
  });

  it("ignores another environment's event with 200: no Stripe call, no rows, no event recorded", async () => {
    const { row } = await paidMonthlyCheckout();
    const response = await deliver(
      stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId, "staging")),
    );
    expect(response.status).toBe(200);
    expect(stripe.calls["checkout.sessions.retrieve"]).toBeUndefined();
    expect(await getDb().select().from(policies)).toHaveLength(0);
    expect(await recordedEvents()).toHaveLength(0);

    const invoice = presetInvoice(stripe, {
      id: "in_other",
      subscriptionId: "sub_other",
      periodStart: MONTH_2,
      kerbEnv: "production",
    });
    expect((await deliver(stripeEvent("invoice.paid", invoice))).status).toBe(200);
    expect(stripe.calls["invoices.retrieve"]).toBeUndefined();
    expect(await recordedEvents()).toHaveLength(0);
  });

  it("ignores an untagged object with 200 and a warning", async () => {
    const response = await deliver(
      stripeEvent("checkout.session.completed", sessionObject("cs_test_untagged", null)),
    );
    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    expect(stripe.calls["checkout.sessions.retrieve"]).toBeUndefined();
    expect(await recordedEvents()).toHaveLength(0);
  });

  it("answers an event type Kerb doesn't handle with 200", async () => {
    const response = await deliver(
      stripeEvent("charge.succeeded", { id: "ch_1", object: "charge", metadata: {} }),
    );
    expect(response.status).toBe(200);
    expect(await recordedEvents()).toHaveLength(0);
  });
});

describe("handleStripeWebhook: checkout sessions", () => {
  it("fulfils a completed checkout: one policy, 12 instalments, the event recorded", async () => {
    const { row, subscriptionId } = await paidMonthlyCheckout();
    const event = stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId));
    expect((await deliver(event)).status).toBe(200);

    expect(await getDb().select().from(policies)).toHaveLength(1);
    const rows = await instalments(subscriptionId);
    expect(rows).toHaveLength(12);
    expect(rows[0]!.status).toBe("succeeded");
    const [checkout] = await getDb()
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, row.id));
    expect(checkout!.status).toBe("completed");
    expect(await recordedEvents()).toEqual([
      expect.objectContaining({ eventId: event.id, type: "checkout.session.completed" }),
    ]);
    // fulfilCheckout ends the plan after its 12th period
    expect(stripe.calls["subscriptions.update"]).toHaveLength(1);

    // Delivered again: still one policy
    expect((await deliver(event)).status).toBe(200);
    expect(await getDb().select().from(policies)).toHaveLength(1);
    expect(await recordedEvents()).toHaveLength(1);
  });

  it("makes one policy when the same completed event arrives twice at once", async () => {
    const { row, subscriptionId } = await paidMonthlyCheckout();
    const event = stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId));
    const responses = await Promise.all([deliver(event), deliver(event)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await getDb().select().from(policies)).toHaveLength(1);
    expect(await instalments(subscriptionId)).toHaveLength(12);
    expect(await recordedEvents()).toHaveLength(1);
  });

  it("answers 500 when setting cancel_at fails, recording no event, so Stripe retries", async () => {
    const { row, subscriptionId } = await paidMonthlyCheckout();
    const event = stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId));
    stripe.failOnce("subscriptions.update");

    expect((await deliver(event)).status).toBe(500);
    // The purchase stands; the event isn't recorded
    expect(await getDb().select().from(policies)).toHaveLength(1);
    expect(await recordedEvents()).toHaveLength(0);

    // Stripe's retry sets cancel_at and records the event
    expect((await deliver(event)).status).toBe(200);
    expect(stripe.calls["subscriptions.update"]!.map((c) => c[0])).toEqual([
      subscriptionId,
      subscriptionId,
    ]);
    expect(await recordedEvents()).toHaveLength(1);
    expect(await getDb().select().from(policies)).toHaveLength(1);
  });

  it("answers a session Kerb has no row for with 200 and a warning", async () => {
    paidMonthlySession(stripe, "cs_test_gone", 5000, PERIOD_START);
    const event = stripeEvent("checkout.session.completed", sessionObject("cs_test_gone"));
    expect((await deliver(event)).status).toBe(200);
    expect(warn).toHaveBeenCalled();
    expect(await getDb().select().from(policies)).toHaveLength(0);
  });

  it("expires an open checkout row, and leaves a completed one alone", async () => {
    const { actor, quoteId } = await pricedCarQuote(NOW);
    const row = await startedCheckout(stripe, actor, quoteId, { now: NOW, startsOn: STARTS_ON });
    const expired = stripeEvent("checkout.session.expired", sessionObject(row.stripeSessionId));
    expect((await deliver(expired)).status).toBe(200);
    const statusOf = async () =>
      (await getDb().select().from(checkoutSessions).where(eq(checkoutSessions.id, row.id)))[0]!
        .status;
    expect(await statusOf()).toBe("expired");

    const bought = await boughtMonthly();
    const late = stripeEvent("checkout.session.expired", sessionObject(bought.row.stripeSessionId));
    expect((await deliver(late)).status).toBe(200);
    const [after] = await getDb()
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, bought.row.id));
    expect(after!.status).toBe("completed");
  });
});

describe("handleStripeWebhook: invoice.paid", () => {
  it("marks month 2's row by its billing period, with Stripe's paid time and the invoice id", async () => {
    const { subscriptionId } = await boughtMonthly();
    const invoice = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: PAID_AT,
    });
    expect((await deliver(stripeEvent("invoice.paid", invoice))).status).toBe(200);

    // The invoice was fetched again before acting
    expect(stripe.calls["invoices.retrieve"]!.at(-1)![0]).toBe("in_month_2");
    const rows = await instalments(subscriptionId);
    expect(rows[1]).toMatchObject({
      instalmentNumber: 2,
      status: "succeeded",
      paidAt: new Date(PAID_AT * 1000),
      stripeInvoiceId: "in_month_2",
    });
    expect(rows.slice(2).every((r) => r.status === "scheduled")).toBe(true);
  });

  it("matches the row by its invoice id when Stripe's retry pays an invoice that failed", async () => {
    const { subscriptionId } = await boughtMonthly();
    const failed = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    expect((await deliver(stripeEvent("invoice.payment_failed", failed))).status).toBe(200);
    expect((await instalments(subscriptionId))[1]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_2",
    });

    // The retry: Stripe's invoice now paid, with no line period to go by, so only the id matches
    const paid = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      paidAt: PAID_AT,
    });
    expect((await deliver(stripeEvent("invoice.paid", paid))).status).toBe(200);
    expect((await instalments(subscriptionId))[1]).toMatchObject({
      status: "succeeded",
      paidAt: new Date(PAID_AT * 1000),
    });
  });

  it("leaves the first invoice to fulfilment", async () => {
    const { subscriptionId, invoiceId } = await boughtMonthly();
    const before = await instalments(subscriptionId);
    const first = presetInvoice(stripe, {
      id: invoiceId,
      subscriptionId,
      periodStart: PERIOD_START,
      billingReason: "subscription_create",
      paidAt: PERIOD_START + 60,
    });
    const event = stripeEvent("invoice.paid", first);
    expect((await deliver(event)).status).toBe(200);
    expect(await instalments(subscriptionId)).toEqual(before);
    expect(await recordedEvents()).toHaveLength(2);
  });

  it("answers 500 for month 2 paid before the checkout is fulfilled, then marks it on Stripe's retry", async () => {
    const { row, subscriptionId, quoteId } = await paidMonthlyCheckout();
    // The subscription carries its quote id (subscription_data.metadata), which this database knows
    const invoice = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: PAID_AT,
      quoteId,
    });
    const early = stripeEvent("invoice.paid", invoice);
    expect((await deliver(early)).status).toBe(500);
    expect(await recordedEvents()).toHaveLength(0);
    expect(error).toHaveBeenCalled();

    await deliver(stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId)));
    expect((await deliver(early)).status).toBe(200);
    expect((await instalments(subscriptionId))[1]!.status).toBe("succeeded");
  });
});

describe("handleStripeWebhook: an invoice for a subscription with no instalments (R15)", () => {
  const OTHER_DB_QUOTE = "6f1c2a4e-0b7d-4c1a-9e55-3d2f8a9b0c11";

  for (const type of ["invoice.paid", "invoice.payment_failed"] as const) {
    it(`${type}: a subscription this database doesn't know is 200, recorded, warned, and changes nothing`, async () => {
      const { subscriptionId } = await boughtMonthly();
      const before = await getDb().select().from(payments);
      const jobsBefore = (await getDb().select().from(jobs)).length;
      for (const [id, quoteId] of [
        ["in_reset_1", OTHER_DB_QUOTE],
        ["in_reset_2", undefined],
        ["in_reset_3", "not-a-uuid"],
      ] as const) {
        const invoice = presetInvoice(stripe, {
          id,
          subscriptionId: "sub_from_a_reset_db",
          periodStart: MONTH_2,
          paidAt: PAID_AT,
          status: type === "invoice.paid" ? "paid" : "open",
          quoteId,
        });
        const event = stripeEvent(type, invoice);
        expect((await deliver(event)).status).toBe(200);
        expect((await recordedEvents()).map((e) => e.eventId)).toContain(event.id);
      }
      expect(warn).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(OTHER_DB_QUOTE);
      expect(await getDb().select().from(payments)).toEqual(before);
      expect(await getDb().select().from(jobs)).toHaveLength(jobsBefore);
      expect(error).not.toHaveBeenCalled();
      expect(
        (await instalments(subscriptionId)).slice(1).every((r) => r.status === "scheduled"),
      ).toBe(true);
    });

    it(`${type}: a known quote with no instalments yet is 500 and records nothing (Review Focus 4)`, async () => {
      const { subscriptionId, quoteId } = await paidMonthlyCheckout();
      const invoice = presetInvoice(stripe, {
        id: "in_month_2",
        subscriptionId,
        periodStart: MONTH_2,
        paidAt: PAID_AT,
        status: type === "invoice.paid" ? "paid" : "open",
        quoteId,
      });
      expect((await deliver(stripeEvent(type, invoice))).status).toBe(500);
      expect(await recordedEvents()).toHaveLength(0);
      expect(error).toHaveBeenCalledWith(expect.any(String), { name: "StripeEventNotReady" });
    });
  }
});

describe("handleStripeWebhook: invoice.payment_failed", () => {
  it("marks the row failed and emails the customer once for the invoice", async () => {
    const { subscriptionId, actor } = await boughtMonthly();
    const invoice = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    // Stripe's first attempt fails, then a retry fails too: two events for one invoice
    expect((await deliver(stripeEvent("invoice.payment_failed", invoice))).status).toBe(200);
    expect((await deliver(stripeEvent("invoice.payment_failed", invoice))).status).toBe(200);

    expect((await instalments(subscriptionId))[1]).toMatchObject({
      status: "failed",
      paidAt: null,
      stripeInvoiceId: "in_month_2",
    });
    const [user] = await getDb().select().from(users).where(eq(users.id, actor.userId));
    const emails = await failedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]!.payload).toMatchObject({
      to: user!.email,
      template: "payment_failed",
      params: { url: `${authUrls(env).baseURL}/account/billing` },
    });
  });

  it("acts once on the same event delivered twice, one after the other and at once", async () => {
    const { subscriptionId } = await boughtMonthly();
    const invoice = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    const event = stripeEvent("invoice.payment_failed", invoice);
    const retrievesBefore = stripe.calls["invoices.retrieve"]?.length ?? 0;

    const responses = await Promise.all([deliver(event), deliver(event)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await deliver(event)).status).toBe(200);

    // Only one delivery got past the stripe_events gate to fetch the invoice
    expect(stripe.calls["invoices.retrieve"]!.length - retrievesBefore).toBe(1);
    expect(await failedEmails()).toHaveLength(1);
    expect(
      (await recordedEvents()).filter((e) => e.type === "invoice.payment_failed"),
    ).toHaveLength(1);
  });

  it("does nothing when Stripe has since paid the invoice", async () => {
    const { subscriptionId } = await boughtMonthly();
    const stale = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: PAID_AT,
    });
    expect((await deliver(stripeEvent("invoice.payment_failed", stale))).status).toBe(200);
    expect((await instalments(subscriptionId))[1]!.status).toBe("scheduled");
    expect(await failedEmails()).toHaveLength(0);
  });
});

describe("handleStripeWebhook: a handler that throws", () => {
  it("answers 500, rolls back, records no event and logs only the error's name", async () => {
    const { subscriptionId } = await boughtMonthly();
    const invoice = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    stripe.fail("invoices.retrieve", new Error("card 4242 and secrets"));
    const event = stripeEvent("invoice.payment_failed", invoice);
    expect((await deliver(event)).status).toBe(500);

    expect((await recordedEvents()).map((e) => e.eventId)).not.toContain(event.id);
    expect((await instalments(subscriptionId))[1]!.status).toBe("scheduled");
    expect(await failedEmails()).toHaveLength(0);
    expect(JSON.stringify(error.mock.calls)).not.toContain("4242");
    expect(error).toHaveBeenCalledWith(expect.any(String), { name: "Error" });
  });
});
