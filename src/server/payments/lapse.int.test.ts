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
import { setStripeCustomerId } from "#/server/data/checkout-rows";
import { clearReferenceCaches, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, jobs, payments, policies } from "#/server/db/schema";
import { getAuthEnv } from "#/server/env";
import { runDueJobs } from "#/server/jobs/runner";
import type { JobDeps } from "#/server/jobs/types";
import { billingTime } from "#/server/quote/fulfil";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer, makeUser } from "#/test/factories";
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
import { resolveActor } from "#/server/auth/actor";

import { billingPortalFor } from "./billing";
import { runLapsedCancellations } from "./lapse";
import { handleStripeWebhook } from "./webhook";

// Lapse, resume, voiding and cancellation for monthly plans (5.6b, decisions 7 to 9): Stripe gives
// up on a payment (unpaid) and the cover stops; invoices made while it's stopped are voided; a new
// card pays what was owed while covered and the cover resumes; 30 days lapsed, the daily job
// cancels. And /account/billing's portal session, only ever for the actor's own customer.

const DAY = 86_400;
const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const PERIOD_START = Math.floor(NOW.getTime() / 1000);
const MONTH_2 = billingTime(PERIOD_START, 1);
const MONTH_3 = billingTime(PERIOD_START, 2);
const MONTH_4 = billingTime(PERIOD_START, 3);
const MONTH_5 = billingTime(PERIOD_START, 4);
// Stripe gives up on month 2 a couple of weeks after it failed
const LAPSED_AT = MONTH_2 + 14 * DAY;

const stripe = fakeStripe();
const jobsDeps: JobDeps = {
  sendEmail: vi.fn(),
  defer: () => undefined,
  holdEmails: true,
  stripe,
};
const deps = { stripe, webhookSecret: TEST_WEBHOOK_SECRET, now: NOW, jobs: jobsDeps };
const deliver = (event: Record<string, unknown>, nowSeconds?: number) =>
  handleStripeWebhook(
    signedRequest(event),
    nowSeconds === undefined ? deps : { ...deps, now: new Date(nowSeconds * 1000) },
  );

const billingUrl = () => `${authUrls(getAuthEnv()).baseURL}/account/billing`;

const policyOf = async (quoteId: string) =>
  (await getDb().select().from(policies).where(eq(policies.quoteId, quoteId)))[0]!;
const instalments = (subscriptionId: string) =>
  getDb()
    .select()
    .from(payments)
    .where(eq(payments.stripeSubscriptionId, subscriptionId))
    .orderBy(asc(payments.instalmentNumber));
const audits = async (action: string) =>
  (await getDb().select().from(auditLog)).filter((row) => row.action === action);
const emails = async (template: string) =>
  (await getDb().select().from(jobs)).filter(
    (j) => (j.payload as { template?: string }).template === template,
  );

/** A monthly plan bought through the webhook: 12 rows, the first paid, the policy active */
async function boughtMonthly() {
  const { actor, quoteId } = await pricedCarQuote(NOW);
  const row = await startedCheckout(stripe, actor, quoteId, { now: NOW, startsOn: STARTS_ON });
  const ids = paidMonthlySession(stripe, row.stripeSessionId, row.amountPence, PERIOD_START);
  const response = await deliver(
    stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId)),
  );
  expect(response.status).toBe(200);
  return { actor, quoteId, ...ids };
}

/** The subscription as a fresh retrieve returns it */
function presetSubscription(
  id: string,
  fields: { status: string; customer?: string; cancel_at?: number; ended_at?: number },
) {
  const object = {
    object: "subscription",
    metadata: { kerb_env: "local" },
    cancel_at: null,
    ended_at: null,
    ...fields,
  };
  stripe.set("subscriptions.retrieve", id, object);
  return { id, ...object };
}

/** Stripe's subscription.updated/deleted event, `created` at `at` (Unix seconds) */
function subscriptionEvent(type: string, subscription: Record<string, unknown>, at: number) {
  return stripeEvent(type, subscription, { created: at });
}

/** Month 2's payment fails (still covered), then Stripe gives up: unpaid, and the policy lapses */
async function lapsedPlan(lapsedAt = LAPSED_AT, month2 = "in_month_2") {
  const bought = await boughtMonthly();
  const failed = presetInvoice(stripe, {
    id: month2,
    subscriptionId: bought.subscriptionId,
    periodStart: MONTH_2,
    status: "open",
  });
  expect((await deliver(stripeEvent("invoice.payment_failed", failed))).status).toBe(200);
  const unpaid = presetSubscription(bought.subscriptionId, {
    status: "unpaid",
    customer: "cus_test_1",
  });
  expect(
    (await deliver(subscriptionEvent("customer.subscription.updated", unpaid, lapsedAt))).status,
  ).toBe(200);
  return bought;
}

/** Kerb's row for an instalment recorded paid (what invoice.paid writes), without the handler */
async function recordPaid(subscriptionId: string, instalment: number, paidAt: number) {
  const row = (await instalments(subscriptionId))[instalment - 1]!;
  await getDb()
    .update(payments)
    .set({ status: "succeeded", paidAt: new Date(paidAt * 1000) })
    .where(eq(payments.id, row.id));
}

/** The customer as Stripe holds it, with a default card */
function presetCustomer(id: string, defaultCard: string | null) {
  const object = {
    object: "customer",
    metadata: { kerb_env: "local" },
    invoice_settings: { default_payment_method: defaultCard },
  };
  stripe.set("customers.retrieve", id, object);
  return { id, ...object };
}

/** The portal's "new card": customer.updated with the default card changed */
function newDefaultCardEvent(customerId: string, card: string) {
  const event = stripeEvent("customer.updated", presetCustomer(customerId, card));
  (event.data as Record<string, unknown>).previous_attributes = {
    invoice_settings: { default_payment_method: "pm_old" },
  };
  return event;
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

describe("customer.subscription.updated: unpaid", () => {
  it("lapses the policy at the event's time, audited once and emailed once", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();

    // Fetched again before acting
    expect(stripe.calls["subscriptions.retrieve"]!.at(-1)![0]).toBe(subscriptionId);
    const policy = await policyOf(quoteId);
    expect(policy).toMatchObject({ status: "lapsed", lapsedAt: new Date(LAPSED_AT * 1000) });
    expect(await audits("policy.lapsed")).toMatchObject([
      { entityType: "policy", entityId: policy.id, actorUserId: null },
    ]);
    const lapsed = await emails("cover_lapsed");
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]!.payload).toMatchObject({ params: { url: billingUrl() } });

    // Another unpaid event (Stripe sends one per change): nothing new
    const again = presetSubscription(subscriptionId, { status: "unpaid" });
    await deliver(subscriptionEvent("customer.subscription.updated", again, LAPSED_AT + 60));
    expect((await policyOf(quoteId)).lapsedAt).toEqual(new Date(LAPSED_AT * 1000));
    expect(await audits("policy.lapsed")).toHaveLength(1);
    expect(await emails("cover_lapsed")).toHaveLength(1);
  });

  it("does nothing for a stale unpaid event when the subscription is active again", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    presetSubscription(subscriptionId, { status: "active" });
    // The event's snapshot says unpaid; Stripe's current state doesn't
    const stale = {
      id: subscriptionId,
      object: "subscription",
      status: "unpaid",
      metadata: { kerb_env: "local" },
    };
    expect(
      (await deliver(subscriptionEvent("customer.subscription.updated", stale, LAPSED_AT))).status,
    ).toBe(200);
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await audits("policy.lapsed")).toHaveLength(0);
    expect(await emails("cover_lapsed")).toHaveLength(0);
  });

  it("doesn't lapse when nothing is owed at Stripe (no open invoice): a stale unpaid after the owed one was paid (R18)", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    // Month 2 failed, then was paid; Stripe may leave the subscription unpaid after that
    presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "paid",
    });
    const unpaid = presetSubscription(subscriptionId, { status: "unpaid" });
    expect(
      (await deliver(subscriptionEvent("customer.subscription.updated", unpaid, LAPSED_AT))).status,
    ).toBe(200);
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await audits("policy.lapsed")).toHaveLength(0);
  });

  it("voids, on lapsing, a later month's invoice that invoice.created left alone while still covered (R18)", async () => {
    const bought = await boughtMonthly();
    presetSubscription(bought.subscriptionId, { status: "past_due" });
    // Month 3's invoice arrives while the policy is still active (past_due): left alone
    const month3 = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId: bought.subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    await deliver(stripeEvent("invoice.created", month3));
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();

    // Then month 2 fails for good and Stripe gives up, after month 3 was invoiced
    const failed = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId: bought.subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    await deliver(stripeEvent("invoice.payment_failed", failed));
    const unpaid = presetSubscription(bought.subscriptionId, { status: "unpaid" });
    await deliver(subscriptionEvent("customer.subscription.updated", unpaid, MONTH_3 - DAY));

    expect((await policyOf(bought.quoteId)).status).toBe("lapsed");
    // Month 3's is voided; month 2's, owed from while covered, stays open
    expect(stripe.calls["invoices.finalizeInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    expect(stripe.calls["invoices.list"]!.map((c) => c[0])).toContainEqual({
      subscription: bought.subscriptionId,
      status: "draft",
      limit: 100,
    });
    const rows = await instalments(bought.subscriptionId);
    expect(rows[1]).toMatchObject({ status: "failed", stripeInvoiceId: "in_month_2" });
    expect(rows[2]).toMatchObject({ status: "failed", stripeInvoiceId: "in_month_3" });
  });

  it("leaves an active policy alone while the subscription is past_due (Stripe still retrying)", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    const pastDue = presetSubscription(subscriptionId, { status: "past_due" });
    await deliver(subscriptionEvent("customer.subscription.updated", pastDue, LAPSED_AT));
    expect((await policyOf(quoteId)).status).toBe("active");
  });
});

describe("customer.subscription.updated: Kerb's rows decide a resume (R18)", () => {
  it("resumes a lapsed policy once its owed instalment is paid, audited and emailed", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    await recordPaid(subscriptionId, 2, LAPSED_AT + DAY / 2);
    const active = presetSubscription(subscriptionId, { status: "active" });
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT + DAY));
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT + DAY + 60));

    const policy = await policyOf(quoteId);
    expect(policy).toMatchObject({ status: "active", lapsedAt: null, cancelledAt: null });
    expect(await audits("policy.resumed")).toMatchObject([{ entityId: policy.id }]);
    expect(await emails("cover_resumed")).toHaveLength(1);
  });

  it("doesn't resume when Stripe says active but the owed instalment is still failed (Kerb voided a newer invoice)", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    // Voiding the newest invoice can flip Stripe's status to active with nothing paid
    const active = presetSubscription(subscriptionId, { status: "active" });
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT + DAY));
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    expect(await audits("policy.resumed")).toHaveLength(0);
    expect(await emails("cover_resumed")).toHaveLength(0);
  });

  it("resumes on any status once the owed instalment is paid, Stripe still saying unpaid", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    await recordPaid(subscriptionId, 2, LAPSED_AT + DAY / 2);
    // Nothing open at Stripe any more: month 2 is paid
    presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "paid",
    });
    const unpaid = presetSubscription(subscriptionId, { status: "unpaid" });
    await deliver(subscriptionEvent("customer.subscription.updated", unpaid, LAPSED_AT + DAY));
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await audits("policy.resumed")).toHaveLength(1);
    expect(await audits("policy.lapsed")).toHaveLength(1);
  });

  it("is a no-op for an active policy", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    const active = presetSubscription(subscriptionId, { status: "active" });
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT));
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await audits("policy.resumed")).toHaveLength(0);
    expect(await emails("cover_resumed")).toHaveLength(0);
  });

  it("leaves a cancelled policy cancelled", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    const deleted = presetSubscription(subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: LAPSED_AT + DAY,
    });
    await deliver(subscriptionEvent("customer.subscription.deleted", deleted, LAPSED_AT + DAY));
    const active = presetSubscription(subscriptionId, { status: "active" });
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT + 2 * DAY));
    expect((await policyOf(quoteId)).status).toBe("cancelled");
    expect(await audits("policy.resumed")).toHaveLength(0);
  });
});

describe("invoice.created while lapsed", () => {
  it("finalises and voids the invoice, and that month's row is failed", async () => {
    const { subscriptionId } = await lapsedPlan();
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    expect((await deliver(stripeEvent("invoice.created", draft))).status).toBe(200);

    expect(stripe.calls["invoices.finalizeInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    const rows = await instalments(subscriptionId);
    expect(rows[1]).toMatchObject({ status: "failed", stripeInvoiceId: "in_month_2" });
    expect(rows[2]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_3",
      paidAt: null,
    });
  });

  it("leaves alone the month that failed while covered: it's owed (fix F2, R20)", async () => {
    const { subscriptionId } = await lapsedPlan();
    // A late or retried invoice.created for month 2, which failed while covered
    const owed = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    expect((await deliver(stripeEvent("invoice.created", owed))).status).toBe(200);
    expect(stripe.calls["invoices.finalizeInvoice"]).toBeUndefined();
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();
    expect((await instalments(subscriptionId))[1]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_2",
    });
  });

  it("voids a month whose row is still scheduled, though its period began before lapsed_at (R20)", async () => {
    // lapsed_at is a Stripe event's created time, wall-clock even under a test clock, so it says
    // nothing about which months were covered
    const { subscriptionId } = await lapsedPlan(MONTH_3 + DAY);
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    await deliver(stripeEvent("invoice.created", draft));
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
  });

  it("only voids an invoice Stripe has already finalised (open)", async () => {
    const { subscriptionId } = await lapsedPlan();
    const open = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });
    await deliver(stripeEvent("invoice.created", open));
    expect(stripe.calls["invoices.finalizeInvoice"]).toBeUndefined();
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_3",
    });
  });

  it("makes no Stripe call for an invoice already void, and its row is failed", async () => {
    const { subscriptionId } = await lapsedPlan();
    const voided = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "void",
    });
    await deliver(stripeEvent("invoice.created", voided));
    expect(stripe.calls["invoices.finalizeInvoice"]).toBeUndefined();
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();
    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_3",
    });
  });

  it("leaves an invoice for an active policy alone", async () => {
    const { subscriptionId } = await boughtMonthly();
    presetSubscription(subscriptionId, { status: "active" });
    const draft = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "draft",
    });
    expect((await deliver(stripeEvent("invoice.created", draft))).status).toBe(200);
    expect(stripe.calls["invoices.finalizeInvoice"]).toBeUndefined();
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();
    expect((await instalments(subscriptionId))[1]!.status).toBe("scheduled");
  });
});

describe("lapsing again, and more than one invoice owed (second-lapse fix)", () => {
  /** Stripe's invoice for a month fails while the policy is still covered */
  async function failMonth(subscriptionId: string, id: string, periodStart: number) {
    const failed = presetInvoice(stripe, { id, subscriptionId, periodStart, status: "open" });
    expect((await deliver(stripeEvent("invoice.payment_failed", failed))).status).toBe(200);
  }
  /** Stripe gives up at `at` (Unix seconds): unpaid */
  async function giveUp(subscriptionId: string, at: number) {
    const unpaid = presetSubscription(subscriptionId, { status: "unpaid", customer: "cus_test_1" });
    await deliver(subscriptionEvent("customer.subscription.updated", unpaid, at));
  }
  /** Stripe reports the invoice paid (invoice.paid) */
  async function paid(subscriptionId: string, id: string, periodStart: number, at: number) {
    const invoice = presetInvoice(stripe, { id, subscriptionId, periodStart, paidAt: at });
    expect((await deliver(stripeEvent("invoice.paid", invoice))).status).toBe(200);
  }

  it("resumes after a second lapse once its owed invoice is paid; the month voided in the first lapse doesn't count, and the job doesn't cancel", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    // First lapse: month 3 is voided (no cover), then month 2 is paid and the cover resumes
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    await deliver(stripeEvent("invoice.created", draft));
    expect((await instalments(subscriptionId))[2]).toMatchObject({ status: "failed" });
    await deliver(newDefaultCardEvent("cus_test_1", "pm_new"));
    await paid(subscriptionId, "in_month_2", MONTH_2, LAPSED_AT + DAY);
    expect((await policyOf(quoteId)).status).toBe("active");

    // Second lapse: month 5 fails while covered, and Stripe gives up two weeks on
    const secondLapse = MONTH_5 + 14 * DAY;
    await failMonth(subscriptionId, "in_month_5", MONTH_5);
    await giveUp(subscriptionId, secondLapse);
    expect(await policyOf(quoteId)).toMatchObject({
      status: "lapsed",
      lapsedAt: new Date(secondLapse * 1000),
    });

    // A new card pays month 5 (the voided month 3 is not owed), and the cover resumes
    await deliver(newDefaultCardEvent("cus_test_1", "pm_newer"));
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_2", "in_month_5"]);
    await paid(subscriptionId, "in_month_5", MONTH_5, secondLapse + DAY);
    expect(await policyOf(quoteId)).toMatchObject({ status: "active", lapsedAt: null });
    expect(await audits("policy.resumed")).toHaveLength(2);
    const rows = await instalments(subscriptionId);
    expect(rows[2]).toMatchObject({ status: "failed", stripeInvoiceId: "in_month_3" });
    expect(rows[2]!.voidedAt).not.toBeNull();

    // 31 days after the second lapse: nothing lapsed, nothing cancelled
    const jobNow = new Date((secondLapse + 31 * DAY) * 1000);
    expect(await runLapsedCancellations(getDb(), jobNow, jobsDeps)).toEqual({
      cancelled: 0,
      resumed: 0,
      failed: 0,
    });
    expect((await policyOf(quoteId)).status).toBe("active");
  });

  it("pays every invoice owed from while covered, earliest first, and resumes only once all are paid", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    // Stripe's retries for month 2 ran past month 3's billing date: both failed while covered
    await failMonth(subscriptionId, "in_month_2", MONTH_2);
    await failMonth(subscriptionId, "in_month_3", MONTH_3);
    await giveUp(subscriptionId, MONTH_3 + 10 * DAY);
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    // Month 3 began while covered, so it's owed, not voided
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();

    await deliver(newDefaultCardEvent("cus_test_1", "pm_new"));
    const pays = stripe.calls["invoices.pay"]!;
    expect(pays.map((c) => c[0])).toEqual(["in_month_2", "in_month_3"]);
    // Each with its own idempotency key
    expect(pays.map((c) => (c[2] as { idempotencyKey: string }).idempotencyKey)).toEqual([
      "kerb-resume-in_month_2-pm_new",
      "kerb-resume-in_month_3-pm_new",
    ]);

    await paid(subscriptionId, "in_month_2", MONTH_2, MONTH_3 + 11 * DAY);
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    await paid(subscriptionId, "in_month_3", MONTH_3, MONTH_3 + 11 * DAY);
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await emails("cover_resumed")).toHaveLength(1);
  });

  it("counts as owed every month that failed while covered, whatever the lapse's time", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    await failMonth(subscriptionId, "in_month_2", MONTH_2);
    // Month 3 began at 12:00 UTC and failed; Stripe gives up an hour later, the same London day
    await failMonth(subscriptionId, "in_month_3", MONTH_3);
    await giveUp(subscriptionId, MONTH_3 + 3600);
    // Not voided: it began while covered
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();

    // Paying month 2 alone isn't enough: month 3 is owed too
    await paid(subscriptionId, "in_month_2", MONTH_2, MONTH_3 + 2 * 3600);
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    await deliver(newDefaultCardEvent("cus_test_1", "pm_new"));
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    await paid(subscriptionId, "in_month_3", MONTH_3, MONTH_3 + 3 * 3600);
    expect((await policyOf(quoteId)).status).toBe("active");
  });
});

describe("the live test-clock run (R20)", () => {
  it("never voids the owed month though lapsed_at (wall time) is before its period; Stripe flipping to active doesn't resume; a new card then pays it and resumes", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    // Month 3 fails while covered (past_due), its row failed
    const owed = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });
    await deliver(stripeEvent("invoice.payment_failed", owed));
    // Stripe gives up. The event's created is wall-clock time, months before the test clock's
    // month 3; invoice periods follow the clock
    const wallTime = PERIOD_START + 5 * DAY;
    const unpaid = presetSubscription(subscriptionId, { status: "unpaid", customer: "cus_test_1" });
    await deliver(subscriptionEvent("customer.subscription.updated", unpaid, wallTime));
    expect(await policyOf(quoteId)).toMatchObject({
      status: "lapsed",
      lapsedAt: new Date(wallTime * 1000),
    });
    // The owed month is not voided by the lapse's sweep
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();
    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_3",
      voidedAt: null,
    });

    // Month 4's invoice, made while lapsed: no cover, so voided and stamped
    const month4 = presetInvoice(stripe, {
      id: "in_month_4",
      subscriptionId,
      periodStart: MONTH_4,
      status: "draft",
    });
    await deliver(stripeEvent("invoice.created", month4));
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_4"]);
    expect((await instalments(subscriptionId))[3]!.voidedAt).not.toBeNull();

    // Voiding Stripe's newest invoice flips the subscription to active: no resume, nothing paid
    const active = presetSubscription(subscriptionId, { status: "active", customer: "cus_test_1" });
    await deliver(subscriptionEvent("customer.subscription.updated", active, wallTime + 60));
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    expect(await audits("policy.resumed")).toHaveLength(0);
    expect(await emails("cover_resumed")).toHaveLength(0);

    // A new card while Stripe says active: made the subscription's card, and month 3 is paid
    expect((await deliver(newDefaultCardEvent("cus_test_1", "pm_new"))).status).toBe(200);
    expect(stripe.calls["subscriptions.update"]!.at(-1)!.slice(0, 2)).toEqual([
      subscriptionId,
      { default_payment_method: "pm_new" },
    ]);
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_3"]);
    const paidInvoice = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      paidAt: wallTime + 120,
    });
    expect((await deliver(stripeEvent("invoice.paid", paidInvoice))).status).toBe(200);
    expect(await policyOf(quoteId)).toMatchObject({ status: "active", lapsedAt: null });
    expect(await emails("cover_resumed")).toHaveLength(1);
  });
});

describe("after a resume, Stripe keeps the subscription unpaid: Kerb charges new months (R21)", () => {
  const RESUMED_AT = LAPSED_AT + DAY;
  const cardError = () =>
    Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
  const retryJobs = async () =>
    (await getDb().select().from(jobs)).filter((j) => j.type === "payments.retry_invoice");
  const at = (seconds: number) => new Date(seconds * 1000);

  /** Lapsed on month 2, which a new card then pays: active again, Stripe still `unpaid` */
  async function resumedPlan() {
    const bought = await lapsedPlan();
    await deliver(newDefaultCardEvent("cus_test_1", "pm_new"));
    const paid = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId: bought.subscriptionId,
      periodStart: MONTH_2,
      paidAt: RESUMED_AT,
    });
    await deliver(stripeEvent("invoice.paid", paid));
    expect((await policyOf(bought.quoteId)).status).toBe("active");
    // Its most recent invoice void or unpaid, Stripe leaves the subscription unpaid
    stripe.set("subscriptions.retrieve", bought.subscriptionId, {
      object: "subscription",
      metadata: { kerb_env: "local" },
      status: "unpaid",
      customer: "cus_test_1",
      default_payment_method: "pm_new",
      cancel_at: null,
      ended_at: null,
    });
    stripe.calls["invoices.pay"]?.splice(0);
    return bought;
  }

  /** Month 3's invoice, created as Stripe makes one for an unpaid subscription: a draft */
  async function month3Created(subscriptionId: string) {
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    return deliver(stripeEvent("invoice.created", draft), MONTH_3);
  }

  /** The retry jobs due at `when` (Unix seconds), run */
  const runJobsAt = (when: number) => runDueJobs(getDb(), jobsDeps, at(when));

  it("finalises and pays the new month's draft with the subscription's card; invoice.paid marks the row", async () => {
    const { subscriptionId } = await resumedPlan();
    expect((await month3Created(subscriptionId)).status).toBe(200);

    expect(stripe.calls["invoices.finalizeInvoice"]!.map((c) => c.slice(0, 2))).toEqual([
      ["in_month_3", { auto_advance: false }],
    ]);
    expect(stripe.calls["invoices.pay"]).toEqual([
      ["in_month_3", { payment_method: "pm_new" }, { idempotencyKey: "kerb-charge-in_month_3-1" }],
    ]);
    expect(stripe.calls["invoices.voidInvoice"]).toBeUndefined();
    expect(await retryJobs()).toHaveLength(0);

    const paid = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      paidAt: MONTH_3 + 60,
    });
    await deliver(stripeEvent("invoice.paid", paid));
    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "succeeded",
      stripeInvoiceId: "in_month_3",
    });
  });

  it("on a declined card: the row failed, one payment_failed email, and retry 1 queued 2 days on", async () => {
    const { subscriptionId } = await resumedPlan();
    const failedEmailsBefore = (await emails("payment_failed")).length;
    stripe.failOnce("invoices.pay", cardError());
    expect((await month3Created(subscriptionId)).status).toBe(200);

    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "failed",
      stripeInvoiceId: "in_month_3",
      voidedAt: null,
    });
    expect(await emails("payment_failed")).toHaveLength(failedEmailsBefore + 1);
    // Stripe's own invoice.payment_failed for Kerb's attempt doesn't email again
    const failed = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });
    await deliver(stripeEvent("invoice.payment_failed", failed));
    expect(await emails("payment_failed")).toHaveLength(failedEmailsBefore + 1);

    const [job] = await retryJobs();
    expect(job).toMatchObject({
      status: "queued",
      payload: { invoiceId: "in_month_3", subscriptionId, attempt: 1 },
      runAfter: at(MONTH_3 + 2 * DAY),
    });
  });

  it("a retry that succeeds ends the chain", async () => {
    const { quoteId, subscriptionId } = await resumedPlan();
    stripe.failOnce("invoices.pay", cardError());
    await month3Created(subscriptionId);
    presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });

    await runJobsAt(MONTH_3 + 2 * DAY);
    expect(stripe.calls["invoices.pay"]!.map((c) => c[2])).toEqual([
      { idempotencyKey: "kerb-charge-in_month_3-1" },
      { idempotencyKey: "kerb-charge-in_month_3-2" },
    ]);
    const jobs = await retryJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("done");
    expect((await policyOf(quoteId)).status).toBe("active");
  });

  it("after three failed retries (2, 4 and 6 days on), lapses the policy: audited, emailed, the sweep run, and no 4th retry", async () => {
    const { quoteId, subscriptionId } = await resumedPlan();
    stripe.fail("invoices.pay", cardError());
    await month3Created(subscriptionId);
    presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });

    await runJobsAt(MONTH_3 + 2 * DAY);
    await runJobsAt(MONTH_3 + 4 * DAY);
    expect((await policyOf(quoteId)).status).toBe("active");
    // Month 4's draft made meanwhile: the lapse's sweep voids it
    presetInvoice(stripe, {
      id: "in_month_4",
      subscriptionId,
      periodStart: MONTH_4,
      status: "draft",
    });
    await runJobsAt(MONTH_3 + 6 * DAY);

    expect(
      stripe.calls["invoices.pay"]!.map((c) => (c[2] as { idempotencyKey: string }).idempotencyKey),
    ).toEqual([
      "kerb-charge-in_month_3-1",
      "kerb-charge-in_month_3-2",
      "kerb-charge-in_month_3-3",
      "kerb-charge-in_month_3-4",
    ]);
    expect(await policyOf(quoteId)).toMatchObject({
      status: "lapsed",
      lapsedAt: at(MONTH_3 + 6 * DAY),
    });
    expect(await audits("policy.lapsed")).toHaveLength(2);
    expect(await emails("cover_lapsed")).toHaveLength(2);
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual(["in_month_4"]);
    // Month 3 failed while covered: owed, not voided
    expect((await instalments(subscriptionId))[2]).toMatchObject({
      status: "failed",
      voidedAt: null,
    });
    const jobs = await retryJobs();
    // A done job's payload is emptied, so the attempts are read from the keys
    expect(jobs.map((j) => j.idempotencyKey).sort()).toEqual([
      "payments.retry_invoice:in_month_3:1",
      "payments.retry_invoice:in_month_3:2",
      "payments.retry_invoice:in_month_3:3",
    ]);
    expect(jobs.every((j) => j.status === "done")).toBe(true);

    // A new card then pays month 3 and the cover resumes, as after any lapse
    stripe.reset();
    stripe.set("subscriptions.retrieve", subscriptionId, { status: "unpaid" });
    presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "open",
    });
    await deliver(newDefaultCardEvent("cus_test_1", "pm_newer"));
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_3"]);
  });

  it("a retry does nothing when the invoice is paid or void, or the policy isn't active", async () => {
    const { quoteId, subscriptionId } = await resumedPlan();
    stripe.failOnce("invoices.pay", cardError());
    await month3Created(subscriptionId);
    const pays = () => stripe.calls["invoices.pay"]!.length;

    // Paid meanwhile (Stripe's own retry, say)
    presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "paid",
    });
    await runJobsAt(MONTH_3 + 2 * DAY);
    expect(pays()).toBe(1);

    for (const [attempt, status, policyStatus] of [
      [2, "void", "active"],
      [3, "open", "lapsed"],
    ] as const) {
      presetInvoice(stripe, { id: "in_month_3", subscriptionId, periodStart: MONTH_3, status });
      if (policyStatus === "lapsed") {
        await getDb()
          .update(policies)
          .set({ status: "lapsed", lapsedAt: at(MONTH_3) })
          .where(eq(policies.quoteId, quoteId));
      }
      await getDb()
        .insert(jobs)
        .values({
          type: "payments.retry_invoice",
          payload: { invoiceId: "in_month_3", subscriptionId, attempt },
          idempotencyKey: `test-retry-${attempt}`,
          runAfter: at(MONTH_3 + 3 * DAY),
        });
      await runJobsAt(MONTH_3 + 3 * DAY);
      expect(pays()).toBe(1);
    }
    expect((await retryJobs()).every((j) => j.status === "done")).toBe(true);
    expect(await audits("policy.lapsed")).toHaveLength(1);
  });

  it("charges nothing while the subscription is past_due (Stripe is still retrying)", async () => {
    const { subscriptionId } = await resumedPlan();
    presetSubscription(subscriptionId, { status: "past_due" });
    await month3Created(subscriptionId);
    expect(stripe.calls["invoices.pay"] ?? []).toHaveLength(0);
    expect(stripe.calls["invoices.finalizeInvoice"]).toBeUndefined();
  });
});

describe("hardening (R21 minors)", () => {
  it("a new card skips a lapsed policy's subscription that Stripe has cancelled", async () => {
    const { subscriptionId } = await lapsedPlan();
    presetSubscription(subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: PERIOD_START + 365 * DAY,
    });
    const updatesBefore = stripe.calls["subscriptions.update"]?.length ?? 0;
    expect((await deliver(newDefaultCardEvent("cus_test_1", "pm_new"))).status).toBe(200);
    expect(stripe.calls["subscriptions.update"]?.length ?? 0).toBe(updatesBefore);
    expect(stripe.calls["invoices.pay"]).toBeUndefined();
  });

  it("retries the void once when it fails just after Kerb's finalise", async () => {
    const { subscriptionId } = await lapsedPlan();
    stripe.failOnce("invoices.voidInvoice", new Error("Stripe is busy"));
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    expect((await deliver(stripeEvent("invoice.created", draft))).status).toBe(200);
    expect(stripe.calls["invoices.voidInvoice"]!.map((c) => c[0])).toEqual([
      "in_month_3",
      "in_month_3",
    ]);
    expect((await instalments(subscriptionId))[2]!.voidedAt).not.toBeNull();
  });

  it("answers 500 when the void fails twice, so Stripe redelivers", async () => {
    const { subscriptionId } = await lapsedPlan();
    stripe.fail("invoices.voidInvoice", new Error("Stripe is busy"));
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    expect((await deliver(stripeEvent("invoice.created", draft))).status).toBe(500);
    expect(stripe.calls["invoices.voidInvoice"]).toHaveLength(2);
  });
});

describe("a new card", () => {
  /** Lapsed, with month 3's invoice voided: month 2's is the one owed */
  async function lapsedWithVoidedMonth() {
    const bought = await lapsedPlan();
    const draft = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId: bought.subscriptionId,
      periodStart: MONTH_3,
      status: "draft",
    });
    await deliver(stripeEvent("invoice.created", draft));
    return bought;
  }

  it("on an unpaid subscription: makes it the subscription's card, pays the invoice that failed while covered, then invoice.paid resumes the cover", async () => {
    const { quoteId, subscriptionId } = await lapsedWithVoidedMonth();

    expect((await deliver(newDefaultCardEvent("cus_test_1", "pm_new"))).status).toBe(200);
    expect(stripe.calls["subscriptions.update"]!.at(-1)!.slice(0, 2)).toEqual([
      subscriptionId,
      { default_payment_method: "pm_new" },
    ]);
    // Month 2's, not month 3's (voided, no cover then)
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_2"]);
    // Still lapsed until Stripe says the invoice is paid
    expect((await policyOf(quoteId)).status).toBe("lapsed");

    presetSubscription(subscriptionId, { status: "active" });
    const paid = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: LAPSED_AT + DAY,
    });
    expect((await deliver(stripeEvent("invoice.paid", paid))).status).toBe(200);

    const policy = await policyOf(quoteId);
    expect(policy).toMatchObject({ status: "active", lapsedAt: null, cancelledAt: null });
    expect(await audits("policy.resumed")).toMatchObject([{ entityId: policy.id }]);
    const resumed = await emails("cover_resumed");
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.payload).toMatchObject({ params: { url: billingUrl() } });
    const rows = await instalments(subscriptionId);
    expect(rows[1]).toMatchObject({ status: "succeeded", stripeInvoiceId: "in_month_2" });
    // The voided month stays failed: the year has 11 paid instalments at most
    expect(rows[2]).toMatchObject({ status: "failed", stripeInvoiceId: "in_month_3" });
  });

  it("invoice.paid for the owed month resumes the cover while Stripe still says unpaid (R18)", async () => {
    const { quoteId, subscriptionId } = await lapsedWithVoidedMonth();
    presetSubscription(subscriptionId, { status: "unpaid" });
    const paid = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: LAPSED_AT + DAY,
    });
    expect((await deliver(stripeEvent("invoice.paid", paid))).status).toBe(200);
    expect(await policyOf(quoteId)).toMatchObject({ status: "active", lapsedAt: null });
    expect(await emails("cover_resumed")).toHaveLength(1);
  });

  it("invoice.paid for a later month doesn't resume while the owed one is still failed", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    presetSubscription(subscriptionId, { status: "active" });
    // Month 3 (after the lapse) paid somehow; month 2, owed from while covered, still failed
    const paid = presetInvoice(stripe, {
      id: "in_month_3",
      subscriptionId,
      periodStart: MONTH_3,
      paidAt: MONTH_3 + DAY,
    });
    expect((await deliver(stripeEvent("invoice.paid", paid))).status).toBe(200);
    expect((await policyOf(quoteId)).status).toBe("lapsed");
    expect(await audits("policy.resumed")).toHaveLength(0);
  });

  it("attached as a payment method (resolved through its customer) does the same", async () => {
    const { subscriptionId } = await lapsedWithVoidedMonth();
    presetCustomer("cus_test_1", "pm_old");
    const attached = stripeEvent("payment_method.attached", {
      id: "pm_attached",
      object: "payment_method",
      customer: "cus_test_1",
    });
    expect((await deliver(attached)).status).toBe(200);
    expect(stripe.calls["customers.retrieve"]!.map((c) => c[0])).toContain("cus_test_1");
    expect(stripe.calls["subscriptions.update"]!.at(-1)!.slice(0, 2)).toEqual([
      subscriptionId,
      { default_payment_method: "pm_attached" },
    ]);
    expect(stripe.calls["invoices.pay"]!.map((c) => c[0])).toEqual(["in_month_2"]);
  });

  it("while past_due (still covered) pays nothing: Stripe's own retries handle it (Review Focus 5)", async () => {
    const { subscriptionId } = await boughtMonthly();
    const failed = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      status: "open",
    });
    await deliver(stripeEvent("invoice.payment_failed", failed));
    presetSubscription(subscriptionId, { status: "past_due" });
    const updatesBefore = stripe.calls["subscriptions.update"]?.length ?? 0;

    expect((await deliver(newDefaultCardEvent("cus_test_1", "pm_new"))).status).toBe(200);
    expect(stripe.calls["subscriptions.update"]?.length ?? 0).toBe(updatesBefore);
    expect(stripe.calls["invoices.pay"]).toBeUndefined();
  });

  it("does nothing when the customer changed something other than the default card", async () => {
    await lapsedPlan();
    const event = stripeEvent("customer.updated", presetCustomer("cus_test_1", "pm_old"));
    (event.data as Record<string, unknown>).previous_attributes = { name: "Maya P" };
    expect((await deliver(event)).status).toBe(200);
    expect(stripe.calls["invoices.pay"]).toBeUndefined();
  });

  it("ignores another environment's customer with 200", async () => {
    await lapsedPlan();
    const event = newDefaultCardEvent("cus_test_1", "pm_new");
    (event.data as { object: { metadata: object } }).object.metadata = { kerb_env: "staging" };
    expect((await deliver(event)).status).toBe(200);
    expect(stripe.calls["invoices.pay"]).toBeUndefined();
  });
});

describe("customer.subscription.deleted", () => {
  it("does nothing when the term is over (ended at its cancel_at)", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    const ended = presetSubscription(subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: PERIOD_START + 365 * DAY,
    });
    const event = subscriptionEvent(
      "customer.subscription.deleted",
      ended,
      PERIOD_START + 365 * DAY,
    );
    expect((await deliver(event)).status).toBe(200);
    expect((await policyOf(quoteId)).status).toBe("active");
    expect(await audits("policy.cancelled_unpaid")).toHaveLength(0);
  });

  it("cancels the policies when the subscription ended any other way", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    const at = LAPSED_AT + 5 * DAY;
    const deleted = presetSubscription(subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: at,
    });
    expect(
      (await deliver(subscriptionEvent("customer.subscription.deleted", deleted, at))).status,
    ).toBe(200);
    const policy = await policyOf(quoteId);
    expect(policy).toMatchObject({ status: "cancelled", lapsedAt: null });
    expect(policy.cancelledAt).toEqual(new Date(at * 1000));
    expect(await audits("policy.cancelled_unpaid")).toMatchObject([{ entityId: policy.id }]);
    // A lapsed policy cancelled: the customer is told, once
    const sent = await emails("policy_cancelled_unpaid");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ params: { url: billingUrl() } });

    // A redelivery as a new event (or Kerb's own job's cancel arriving): already cancelled
    await deliver(subscriptionEvent("customer.subscription.deleted", deleted, at + 60));
    expect(await audits("policy.cancelled_unpaid")).toHaveLength(1);
    expect(await emails("policy_cancelled_unpaid")).toHaveLength(1);
  });

  it("cancels an active policy (cancelled in Stripe's dashboard, say) without the unpaid email", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    const at = MONTH_2 + DAY;
    const deleted = presetSubscription(subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: at,
    });
    expect(
      (await deliver(subscriptionEvent("customer.subscription.deleted", deleted, at))).status,
    ).toBe(200);
    expect((await policyOf(quoteId)).status).toBe("cancelled");
    expect(await emails("policy_cancelled_unpaid")).toHaveLength(0);
  });
});

describe("the daily 30-day cancellation (payments.lapsed_cancellations)", () => {
  const JOB_NOW = new Date((LAPSED_AT + 31 * DAY) * 1000);

  it("cancels a policy lapsed 31 days at Stripe and in Kerb, audited and emailed; one lapsed 29 days is untouched", async () => {
    const old = await lapsedPlan(LAPSED_AT, "in_old_2");
    const recent = await lapsedPlan(LAPSED_AT + 2 * DAY, "in_recent_2");
    stripe.calls["subscriptions.cancel"]?.splice(0);

    const result = await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps);
    expect(result).toEqual({ cancelled: 1, resumed: 0, failed: 0 });

    expect(stripe.calls["subscriptions.cancel"]!.map((c) => c[0])).toEqual([old.subscriptionId]);
    // No proration, no refund of the unused part
    expect(stripe.calls["subscriptions.cancel"]![0]![1]).toMatchObject({ prorate: false });
    const cancelled = await policyOf(old.quoteId);
    expect(cancelled).toMatchObject({ status: "cancelled", lapsedAt: null, cancelledAt: JOB_NOW });
    expect(await audits("policy.cancelled_unpaid")).toMatchObject([
      { entityId: cancelled.id, actorUserId: null },
    ]);
    const sent = await emails("policy_cancelled_unpaid");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ params: { url: billingUrl() } });
    expect(await policyOf(recent.quoteId)).toMatchObject({ status: "lapsed" });

    // Stripe's deleted event for Kerb's own cancel: already cancelled, nothing more
    const deleted = presetSubscription(old.subscriptionId, {
      status: "canceled",
      cancel_at: PERIOD_START + 365 * DAY,
      ended_at: Math.floor(JOB_NOW.getTime() / 1000),
    });
    await deliver(
      subscriptionEvent("customer.subscription.deleted", deleted, LAPSED_AT + 31 * DAY),
    );
    expect(await audits("policy.cancelled_unpaid")).toHaveLength(1);

    // Run again: nothing left to do
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 0,
      resumed: 0,
      failed: 0,
    });
  });

  it("goes on past a Stripe failure, and the job throws at the end so it's retried", async () => {
    const first = await lapsedPlan(LAPSED_AT - DAY, "in_first_2");
    const second = await lapsedPlan(LAPSED_AT, "in_second_2");
    stripe.failOnce(
      "subscriptions.cancel",
      new Error("Stripe is down"),
      (id) => id === first.subscriptionId,
    );

    await getDb().insert(jobs).values({
      type: "payments.lapsed_cancellations",
      payload: {},
      idempotencyKey: "lapsed",
      runAfter: JOB_NOW,
    });
    await runDueJobs(getDb(), jobsDeps, JOB_NOW);

    expect((await policyOf(first.quoteId)).status).toBe("lapsed");
    expect((await policyOf(second.quoteId)).status).toBe("cancelled");
    const [job] = (await getDb().select().from(jobs)).filter(
      (j) => j.type === "payments.lapsed_cancellations",
    );
    expect(job).toMatchObject({ status: "failed", attempts: 1 });
    // Only the error's name is logged
    expect(JSON.stringify(error.mock.calls)).not.toContain("Stripe is down");

    // The retry cancels the first
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 1,
      resumed: 0,
      failed: 0,
    });
    expect((await policyOf(first.quoteId)).status).toBe("cancelled");
  });

  it("resumes, rather than cancels, a policy lapsed 31 days whose owed instalment Kerb has paid, whatever Stripe's status (R18)", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    await recordPaid(subscriptionId, 2, LAPSED_AT + DAY);
    presetSubscription(subscriptionId, { status: "unpaid" });
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 0,
      resumed: 1,
      failed: 0,
    });
    expect(stripe.calls["subscriptions.cancel"]).toBeUndefined();
    expect(await policyOf(quoteId)).toMatchObject({ status: "active", lapsedAt: null });
    expect(await audits("policy.resumed")).toHaveLength(1);
    expect(await audits("policy.cancelled_unpaid")).toHaveLength(0);
    expect(await emails("cover_resumed")).toHaveLength(1);
    expect(await emails("policy_cancelled_unpaid")).toHaveLength(0);
  });

  it("cancels a policy lapsed 31 days whose owed instalment is still failed, though Stripe says active (R18)", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    presetSubscription(subscriptionId, { status: "active" });
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 1,
      resumed: 0,
      failed: 0,
    });
    expect(stripe.calls["subscriptions.cancel"]!.map((c) => c[0])).toEqual([subscriptionId]);
    expect((await policyOf(quoteId)).status).toBe("cancelled");
    expect(await audits("policy.resumed")).toHaveLength(0);
    expect(await emails("policy_cancelled_unpaid")).toHaveLength(1);
  });

  it("leaves a policy cancelled by the job cancelled on a late invoice.paid or updated → active", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps);
    expect((await policyOf(quoteId)).status).toBe("cancelled");

    const active = presetSubscription(subscriptionId, { status: "active" });
    const paid = presetInvoice(stripe, {
      id: "in_month_2",
      subscriptionId,
      periodStart: MONTH_2,
      paidAt: LAPSED_AT + 32 * DAY,
    });
    expect((await deliver(stripeEvent("invoice.paid", paid))).status).toBe(200);
    await deliver(subscriptionEvent("customer.subscription.updated", active, LAPSED_AT + 32 * DAY));
    expect((await policyOf(quoteId)).status).toBe("cancelled");
    expect(await audits("policy.resumed")).toHaveLength(0);
    expect(await emails("cover_resumed")).toHaveLength(0);
  });

  it("doesn't call Stripe's cancel again for a subscription Stripe already cancelled", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    presetSubscription(subscriptionId, { status: "canceled", ended_at: LAPSED_AT + 30 * DAY });
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 1,
      resumed: 0,
      failed: 0,
    });
    expect(stripe.calls["subscriptions.cancel"]).toBeUndefined();
    expect((await policyOf(quoteId)).status).toBe("cancelled");
  });
});

describe("/account/billing: billingPortalFor", () => {
  it("opens the portal for a monthly customer's own Stripe customer, returning to /account", async () => {
    const { actor } = await boughtMonthly();
    const result = await billingPortalFor(actor, { stripe });
    expect(result).toEqual({
      kind: "portal",
      url: expect.stringMatching(/^https:\/\/billing\.stripe\.test\//),
    });
    expect(stripe.calls["billingPortal.sessions.create"]).toEqual([
      [{ customer: "cus_test_1", return_url: `${authUrls(getAuthEnv()).baseURL}/account` }],
    ]);
  });

  it("shows the no-card line to a customer who doesn't pay monthly, even with a Stripe customer (R12)", async () => {
    const user = await makeUser();
    const customer = await makeCustomer({ userId: user.id });
    const actor = (await resolveActor(getDb(), user.id))!;
    expect(await billingPortalFor(actor, { stripe })).toEqual({ kind: "no_monthly" });

    // Paid in full: a Stripe customer, but no subscription
    await setStripeCustomerId(getDb(), customer.id, "cus_annual");
    expect(await billingPortalFor(actor, { stripe })).toEqual({ kind: "no_monthly" });
    expect(stripe.calls["billingPortal.sessions.create"]).toBeUndefined();
  });

  it("shows the line to a user with no customer row (staff)", async () => {
    const user = await makeUser();
    const actor = (await resolveActor(getDb(), user.id))!;
    expect(actor.customerId).toBeNull();
    expect(await billingPortalFor(actor, { stripe })).toEqual({ kind: "no_monthly" });
  });

  it("only ever uses the actor's own customer", async () => {
    const maya = await boughtMonthly();
    // A second customer: Stripe's next customer id
    const { actor: other, quoteId } = await pricedCarQuote(NOW);
    const row = await startedCheckout(stripe, other, quoteId, { now: NOW, startsOn: STARTS_ON });
    paidMonthlySession(stripe, row.stripeSessionId, row.amountPence, PERIOD_START);
    await deliver(stripeEvent("checkout.session.completed", sessionObject(row.stripeSessionId)));

    await billingPortalFor(maya.actor, { stripe });
    await billingPortalFor((await resolveActor(getDb(), other.userId))!, { stripe });
    expect(
      stripe.calls["billingPortal.sessions.create"]!.map(
        (c) => (c[0] as { customer: string }).customer,
      ),
    ).toEqual(["cus_test_1", "cus_test_2"]);
  });
});
