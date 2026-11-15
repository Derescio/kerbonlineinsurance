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
const deliver = (event: Record<string, unknown>) => handleStripeWebhook(signedRequest(event), deps);

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

  it("leaves an active policy alone while the subscription is past_due (Stripe still retrying)", async () => {
    const { quoteId, subscriptionId } = await boughtMonthly();
    const pastDue = presetSubscription(subscriptionId, { status: "past_due" });
    await deliver(subscriptionEvent("customer.subscription.updated", pastDue, LAPSED_AT));
    expect((await policyOf(quoteId)).status).toBe("active");
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

  it("leaves an invoice for an active policy alone", async () => {
    const { subscriptionId } = await boughtMonthly();
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

    // A redelivery as a new event (or Kerb's own job's cancel arriving): already cancelled
    await deliver(subscriptionEvent("customer.subscription.deleted", deleted, at + 60));
    expect(await audits("policy.cancelled_unpaid")).toHaveLength(1);
  });
});

describe("the daily 30-day cancellation (payments.lapsed_cancellations)", () => {
  const JOB_NOW = new Date((LAPSED_AT + 31 * DAY) * 1000);

  it("cancels a policy lapsed 31 days at Stripe and in Kerb, audited and emailed; one lapsed 29 days is untouched", async () => {
    const old = await lapsedPlan(LAPSED_AT, "in_old_2");
    const recent = await lapsedPlan(LAPSED_AT + 2 * DAY, "in_recent_2");
    stripe.calls["subscriptions.cancel"]?.splice(0);

    const result = await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps);
    expect(result).toEqual({ cancelled: 1, failed: 0 });

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
      failed: 0,
    });
    expect((await policyOf(first.quoteId)).status).toBe("cancelled");
  });

  it("doesn't call Stripe's cancel again for a subscription Stripe already cancelled", async () => {
    const { quoteId, subscriptionId } = await lapsedPlan();
    presetSubscription(subscriptionId, { status: "canceled", ended_at: LAPSED_AT + 30 * DAY });
    expect(await runLapsedCancellations(getDb(), JOB_NOW, jobsDeps)).toEqual({
      cancelled: 1,
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
