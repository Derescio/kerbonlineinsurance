import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import type { Actor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { payments, policies, policyChanges, policyVersions } from "#/server/db/schema";
import { handleStripeWebhook } from "#/server/payments/webhook";
import {
  boughtBundle,
  presetSubscription as presetOn,
  boughtCarPolicy,
  boughtHomePolicy,
  resetPolicyWorld,
  setUpPolicyWorld,
} from "#/test/bought-policy";
import { signedRequest, stripeEvent, TEST_WEBHOOK_SECRET } from "#/test/stripe-events";
import { fakeStripe } from "#/test/stripe-fake";

import {
  abandonMyPolicyChange,
  checkMyTopUp,
  confirmMyPolicyChange,
  priceMyPolicyChange,
} from "./writes";

// Settling a change's difference in Stripe (6.3b, decisions 5 and 7). Annual: a dearer change is
// an embedded Checkout for the top-up, applied when checkout.session.completed arrives (and
// refunded in full if the policy moved on meanwhile); a cheaper one is refunded at once. Monthly:
// the remaining instalments and the subscription's price change, with no proration.

const CHANGE_AT = new Date("2027-02-20T10:00:00Z");
const ctx = { headers: new Headers() };
const stripe = fakeStripe();
const jobs = { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true };
const deps = { now: CHANGE_AT, stripe, jobs };
const deliver = (event: Record<string, unknown>) =>
  handleStripeWebhook(signedRequest(event), {
    stripe,
    webhookSecret: TEST_WEBHOOK_SECRET,
    now: CHANGE_AT,
    jobs,
  });

const cover = (coverLevel: "essential" | "comprehensive" | "plus"): PolicyChangeRequest => ({
  kind: "cover",
  coverLevel,
  addons: [],
  voluntaryExcessPence: 0,
});

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  await setUpPolicyWorld();
  vi.stubEnv("VERCEL_TARGET_ENV", "");
});
beforeEach(async () => {
  await resetPolicyWorld();
  stripe.reset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(async () => {
  warn.mockRestore();
  vi.unstubAllEnvs();
  await closeDb();
});

async function priceAndConfirm(actor: Actor, reference: string, change: PolicyChangeRequest) {
  const priced = await priceMyPolicyChange(actor, { input: { reference, change } }, ctx, deps);
  if (!priced.ok || priced.data.status !== "priced") throw new Error("not priced");
  const confirmed = await confirmMyPolicyChange(
    actor,
    { input: { changeId: priced.data.changeId }, idempotencyKey: randomUUID() },
    ctx,
    deps,
  );
  if (!confirmed.ok) throw new Error(confirmed.error.message);
  return { priced: priced.data, confirmed: confirmed.data };
}

async function changeRow(id: string) {
  const [row] = await getDb().select().from(policyChanges).where(eq(policyChanges.id, id));
  return row!;
}

async function versionCount(policyId: string) {
  return (await getDb().select().from(policyVersions).where(eq(policyVersions.policyId, policyId)))
    .length;
}

/** The Checkout Session as Stripe holds it once the customer has paid */
function paySession(
  sessionId: string,
  changeId: string,
  amountTotal: number,
  paymentIntent = "pi_topup_1",
) {
  stripe.set("checkout.sessions.retrieve", sessionId, {
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    amount_total: amountTotal,
    payment_intent: paymentIntent,
    metadata: { kerb_env: "local", policy_change_id: changeId },
  });
}

const sessionEvent = (type: string, sessionId: string, changeId: string) =>
  stripeEvent(type, {
    id: sessionId,
    object: "checkout.session",
    metadata: { kerb_env: "local", policy_change_id: changeId },
  });

describe("annual: a dearer change", () => {
  it("asks for the top-up in an embedded Checkout and applies nothing yet", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced, confirmed } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    expect(priced.settlement).toBe("charge");
    expect(confirmed).toEqual({ status: "pay", clientSecret: expect.stringMatching(/_secret$/) });

    const [params, options] = stripe.calls["checkout.sessions.create"]![0]! as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(params).toMatchObject({
      mode: "payment",
      ui_mode: "embedded_page",
      allowed_payment_method_types: ["card"],
      metadata: { kerb_env: "local", policy_change_id: priced.changeId },
      payment_intent_data: { metadata: { kerb_env: "local", policy_change_id: priced.changeId } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: priced.amountPence,
            product_data: { name: `Change to ${policy.reference}: cover change` },
          },
        },
      ],
    });
    expect(String(params.return_url)).toContain(
      `/account/policies/${policy.reference}?change=${priced.changeId}`,
    );
    expect(options.idempotencyKey).toMatch(new RegExp(`^policy-change-topup:${priced.changeId}:`));
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "awaiting_payment" });
    expect(await versionCount(policy.id)).toBe(1);
  });

  it("applies the change once checkout.session.completed arrives, however many times", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    const event = sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId);
    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200);

    expect(await changeRow(priced.changeId)).toMatchObject({
      status: "applied",
      toVersion: 2,
      stripePaymentIntentId: "pi_topup_1",
    });
    expect(await versionCount(policy.id)).toBe(2);
    const [after] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(after!.coverLevel).toBe("plus");
  });

  it("refunds the top-up in full when the policy changed while they paid", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    await getDb().update(policies).set({ version: 2 }).where(eq(policies.id, policy.id));
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));

    expect(await changeRow(priced.changeId)).toMatchObject({
      status: "failed",
      failureReason: "version_moved",
      stripePaymentIntentId: "pi_topup_1",
    });
    expect(stripe.calls["refunds.create"]![0]![0]).toEqual({ payment_intent: "pi_topup_1" });
    const [after] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(after!.coverLevel).toBe("comprehensive");
  });

  it("refunds a payment for a change they abandoned", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    await abandonMyPolicyChange(actor, { input: { changeId: priced.changeId } }, ctx, deps);
    expect(stripe.calls["checkout.sessions.expire"]?.[0]?.[0]).toBe(stripeSessionId);
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));
    expect(await changeRow(priced.changeId)).toMatchObject({
      status: "failed",
      failureReason: "abandoned",
    });
    expect(stripe.calls["refunds.create"]).toHaveLength(1);
  });

  it("refunds in full a payment that doesn't match the change's price", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    paySession(stripeSessionId!, priced.changeId, priced.amountPence - 1);
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));
    expect(await changeRow(priced.changeId)).toMatchObject({
      status: "failed",
      failureReason: "price_changed",
    });
    expect(stripe.calls["refunds.create"]![0]![0]).toEqual({ payment_intent: "pi_topup_1" });
  });

  it("keeps a change waiting when they close the dialog after paying, so the payment applies it", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    stripe.fail("checkout.sessions.expire");
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    await abandonMyPolicyChange(actor, { input: { changeId: priced.changeId } }, ctx, deps);
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "awaiting_payment" });
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "applied" });
    expect(stripe.calls["refunds.create"]).toBeUndefined();
  });

  it("applies a paid top-up when they come back, with no webhook", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    expect(await checkMyTopUp(actor, { changeId: priced.changeId }, deps)).toEqual({
      status: "applied",
    });
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "applied", toVersion: 2 });
    // The webhook, arriving after, changes nothing
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));
    expect(await versionCount(policy.id)).toBe(2);
  });

  it("leaves an unpaid top-up waiting, and treats someone else's as not found", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    expect(await checkMyTopUp(actor, { changeId: priced.changeId }, deps)).toEqual({
      status: "awaiting_payment",
    });
    const other = await boughtCarPolicy();
    await expect(
      checkMyTopUp(other.actor, { changeId: priced.changeId }, deps),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("marks the change abandoned when its session expires", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { stripeSessionId } = await changeRow(priced.changeId);
    await deliver(sessionEvent("checkout.session.expired", stripeSessionId!, priced.changeId));
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "abandoned" });
  });

  it("refuses a second dearer change while one waits for payment", async () => {
    const { actor, policy } = await boughtCarPolicy();
    await priceAndConfirm(actor, policy.reference, cover("plus"));
    const { confirmed } = await priceAndConfirm(actor, policy.reference, cover("essential"));
    expect(confirmed).toMatchObject({ status: "refused" });
  });
});

describe("annual: a cheaper change", () => {
  it("is applied at Confirm and refunded on the original payment", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const pi = `pi_${policy.quoteId}`;
    stripe.set("paymentIntents.retrieve", pi, {
      amount: 100_000,
      latest_charge: { amount_refunded: 0 },
    });
    const { priced, confirmed } = await priceAndConfirm(
      actor,
      policy.reference,
      cover("essential"),
    );
    expect(priced.settlement).toBe("refund");
    expect(confirmed).toEqual({ status: "applied" });
    expect(stripe.calls["refunds.create"]).toEqual([
      [
        {
          payment_intent: pi,
          amount: priced.amountPence,
          metadata: { policy_change_id: priced.changeId },
        },
        { idempotencyKey: `policy-change-refund:${priced.changeId}:${pi}` },
      ],
    ]);
    expect((await changeRow(priced.changeId)).stripeRefundId).toMatch(/^re_test_/);
  });

  it("repeats its own refund on a retried confirm, never refunding twice", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const pi = `pi_${policy.quoteId}`;
    const priced = await priceMyPolicyChange(
      actor,
      { input: { reference: policy.reference, change: cover("essential") } },
      ctx,
      deps,
    );
    if (!priced.ok || priced.data.status !== "priced") throw new Error("not priced");
    const { changeId, amountPence } = priced.data;
    // A first attempt refunded at Stripe, then its transaction rolled back: the charge shows it
    stripe.set("paymentIntents.retrieve", pi, {
      amount: amountPence,
      latest_charge: {
        amount_refunded: amountPence,
        refunds: {
          data: [{ id: "re_first", amount: amountPence, metadata: { policy_change_id: changeId } }],
        },
      },
    });
    stripe.set("paymentIntents.retrieve", "pi_other", {
      amount: 50_000,
      latest_charge: { amount_refunded: 0 },
    });
    const confirmed = await confirmMyPolicyChange(
      actor,
      { input: { changeId }, idempotencyKey: randomUUID() },
      ctx,
      deps,
    );
    expect(confirmed).toEqual({ ok: true, data: { status: "applied" } });
    expect(stripe.calls["refunds.create"]).toEqual([
      [
        { payment_intent: pi, amount: amountPence, metadata: { policy_change_id: changeId } },
        { idempotencyKey: `policy-change-refund:${changeId}:${pi}` },
      ],
    ]);
  });

  it("spills a refund larger than the original has left onto the latest top-up", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const pi = `pi_${policy.quoteId}`;
    // An earlier top-up, applied
    await getDb()
      .insert(policyChanges)
      .values({
        policyId: policy.id,
        customerId: policy.customerId,
        kind: "cover",
        request: {},
        fromVersion: 1,
        toVersion: 1,
        oldAnnualPence: 1,
        newAnnualPence: 1,
        priceBeforePence: 1,
        priceAfterPence: 1,
        outcome: "quoted",
        settlement: "charge",
        amountPence: 5_000,
        status: "applied",
        appliedAt: new Date("2027-01-10T10:00:00Z"),
        stripePaymentIntentId: "pi_earlier_topup",
      });
    stripe.set("paymentIntents.retrieve", pi, {
      amount: 100_000,
      latest_charge: { amount_refunded: 99_900 },
    });
    stripe.set("paymentIntents.retrieve", "pi_earlier_topup", {
      amount: 5_000,
      latest_charge: { amount_refunded: 0 },
    });
    const { priced } = await priceAndConfirm(actor, policy.reference, cover("essential"));
    const refunds = stripe.calls["refunds.create"]!.map(([params]) => params);
    const metadata = { policy_change_id: priced.changeId };
    expect(refunds).toEqual([
      { payment_intent: pi, amount: 100, metadata },
      { payment_intent: "pi_earlier_topup", amount: priced.amountPence - 100, metadata },
    ]);
  });
});

describe("monthly", () => {
  const presetSubscription = (quoteId: string) => presetOn(stripe, quoteId);

  it("changes the remaining instalments and the subscription's price, with no proration", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const instalment = await presetSubscription(policy.quoteId);
    const { priced, confirmed } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    expect(confirmed).toEqual({ status: "applied" });
    expect(priced.settlement).toBe("instalments");
    const scheduled = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.quoteId, policy.quoteId), eq(payments.status, "scheduled")));
    expect(new Set(scheduled.map((p) => p.amountPence))).toEqual(
      new Set([instalment + priced.amountPence]),
    );
    expect(stripe.calls["subscriptions.update"]).toEqual([
      [
        `sub_${policy.quoteId}`,
        {
          items: [
            {
              id: "si_1",
              price_data: {
                currency: "gbp",
                product: "prod_1",
                unit_amount: instalment + priced.amountPence,
                recurring: { interval: "month" },
              },
            },
          ],
          proration_behavior: "none",
        },
        { idempotencyKey: `policy-change-instalments:${priced.changeId}` },
      ],
    ]);
  });

  it("sends the subscription the instalment from the database, so a retry repeats it", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const instalment = await presetSubscription(policy.quoteId);
    const priced = await priceMyPolicyChange(
      actor,
      { input: { reference: policy.reference, change: cover("plus") } },
      ctx,
      deps,
    );
    if (!priced.ok || priced.data.status !== "priced") throw new Error("not priced");
    // A first attempt moved Stripe's price, then its transaction rolled back
    stripe.set("subscriptions.retrieve", `sub_${policy.quoteId}`, {
      metadata: { kerb_env: "local" },
      items: {
        data: [
          {
            id: "si_1",
            price: { unit_amount: instalment + priced.data.amountPence, product: "prod_1" },
          },
        ],
      },
    });
    await confirmMyPolicyChange(
      actor,
      { input: { changeId: priced.data.changeId }, idempotencyKey: randomUUID() },
      ctx,
      deps,
    );
    const [, params] = stripe.calls["subscriptions.update"]![0]! as [
      string,
      { items: { price_data: { unit_amount: number } }[] },
    ];
    expect(params.items[0]!.price_data.unit_amount).toBe(instalment + priced.data.amountPence);
  });

  it("applies the change with no Stripe call when no instalment is left", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    await getDb()
      .update(payments)
      .set({ status: "succeeded", paidAt: CHANGE_AT })
      .where(eq(payments.quoteId, policy.quoteId));
    const { priced, confirmed } = await priceAndConfirm(actor, policy.reference, cover("plus"));
    expect(confirmed).toEqual({ status: "applied" });
    expect(priced.settlement).toBe("none");
    expect(stripe.calls["subscriptions.update"]).toBeUndefined();
  });

  it("changes a bundle's one subscription, and leaves the home policy's premium", async () => {
    const { actor, car, home } = await boughtBundle("monthly");
    const instalment = await presetSubscription(car.quoteId);
    const { priced } = await priceAndConfirm(actor, car.reference, cover("plus"));
    expect(stripe.calls["subscriptions.update"]).toHaveLength(1);
    const scheduled = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.quoteId, car.quoteId), eq(payments.status, "scheduled")));
    expect(scheduled[0]!.amountPence).toBe(instalment + priced.amountPence);
    const [after] = await getDb().select().from(policies).where(eq(policies.id, home.id));
    expect(after!.annualPremiumPence).toBe(home.annualPremiumPence);
  });
});

// A home change settles the same way (6.3c, decisions 2 and 9)
describe("home", () => {
  const contents = (contentsValuePence: number): PolicyChangeRequest => ({
    kind: "home_contents",
    contentsValuePence,
    valuablesPence: 0,
  });

  it("home annual increase: top-up checkout, applied on checkout.session.completed", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const { priced, confirmed } = await priceAndConfirm(
      actor,
      policy.reference,
      contents(9_000_000),
    );
    expect(priced.settlement).toBe("charge");
    expect(confirmed).toMatchObject({ status: "pay" });
    const [params] = stripe.calls["checkout.sessions.create"]![0]! as [Record<string, unknown>];
    expect(JSON.stringify(params)).toContain(`Change to ${policy.reference}: contents update`);
    const { stripeSessionId } = await changeRow(priced.changeId);
    paySession(stripeSessionId!, priced.changeId, priced.amountPence);
    await deliver(sessionEvent("checkout.session.completed", stripeSessionId!, priced.changeId));
    expect(await changeRow(priced.changeId)).toMatchObject({ status: "applied", toVersion: 2 });
  });

  it("home annual decrease: refunded on the original payment intent", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const pi = `pi_${policy.quoteId}`;
    stripe.set("paymentIntents.retrieve", pi, {
      amount: 100_000,
      latest_charge: { amount_refunded: 0 },
    });
    const { priced, confirmed } = await priceAndConfirm(actor, policy.reference, {
      kind: "home_security",
      lockType: "multipoint",
      windowLocks: "all_accessible",
      alarmType: "monitored",
      hasSmokeAlarm: true,
    });
    expect(priced.settlement).toBe("refund");
    expect(confirmed).toEqual({ status: "applied" });
    expect(stripe.calls["refunds.create"]![0]![0]).toMatchObject({
      payment_intent: pi,
      amount: priced.amountPence,
    });
  });

  it("home monthly: the scheduled instalments and the subscription change", async () => {
    const { actor, policy } = await boughtHomePolicy({ plan: "monthly" });
    const instalment = await presetOn(stripe, policy.quoteId);
    const { priced } = await priceAndConfirm(actor, policy.reference, contents(9_000_000));
    expect(priced.settlement).toBe("instalments");
    expect(stripe.calls["subscriptions.update"]).toHaveLength(1);
    const scheduled = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.quoteId, policy.quoteId), eq(payments.status, "scheduled")));
    expect(scheduled.every((p) => p.amountPence === instalment + priced.amountPence)).toBe(true);
  });

  it("bundled home change: the shared subscription changes and the car's annual premium doesn't", async () => {
    const { actor, car, home } = await boughtBundle("monthly");
    const instalment = await presetOn(stripe, home.quoteId);
    const { priced } = await priceAndConfirm(actor, home.reference, contents(9_000_000));
    expect(stripe.calls["subscriptions.update"]).toHaveLength(1);
    const [scheduled] = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.quoteId, home.quoteId), eq(payments.status, "scheduled")));
    expect(scheduled!.amountPence).toBe(instalment + priced.amountPence);
    const [after] = await getDb().select().from(policies).where(eq(policies.id, car.id));
    expect(after!.annualPremiumPence).toBe(car.annualPremiumPence);
  });
});
