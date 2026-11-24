import type Stripe from "stripe";

import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { todayIso } from "#/features/quote/schemas/dates";
import { authUrls } from "#/server/auth/origins";
import { checkoutDb, setStripeCustomerId } from "#/server/data/checkout-rows";
import {
  loadPolicyForChange,
  lockChangeBySession,
  refundablePaymentIntents,
  shiftScheduledInstalments,
  stripeCustomerOf,
  updatePolicyChange,
  type StoredPolicy,
} from "#/server/data/policy-change-rows";
import { getRatingTables } from "#/server/data/reference";
import { withTx, type Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { kerbEnv } from "#/server/payments/kerb-env";
import type { StripeClient } from "#/server/payments/stripe";

import { changePolicy } from "./apply";
import { priceChange, type PricedChange } from "./price";

// Settling a confirmed change's difference in Stripe (6.3b, decision 5):
// - annual, dearer: an embedded Checkout for the top-up (startTopUp); the change is applied when
//   checkout.session.completed arrives (completeTopUp), or the payment refunded in full if the
//   policy moved on or the change was abandoned meanwhile (decision 7)
// - annual, cheaper: refunded at once, from the purchase's payment and then the top-ups'
// - monthly: the remaining instalments and the subscription's price move, with no proration, so
//   each invoice keeps its one line (the webhook reads only the first)
// Each Stripe call has an idempotency key from the change, so a retried transaction repeats none.

type Quoted = Extract<PricedChange, { outcome: "quoted" }>;

export interface SettleDeps {
  stripe: StripeClient;
  now: Date;
}

const SESSION_SECONDS = 30 * 60;

const KIND_LABEL: Record<PolicyChangeRequest["kind"], string> = {
  address: "new address",
  driver_added: "added driver",
  driver_removed: "removed driver",
  cover: "cover change",
};

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

async function stripeCustomerFor(tx: Tx, customerId: string, stripe: StripeClient) {
  const found = await stripeCustomerOf(tx, customerId);
  if (found.stripeCustomerId) return found.stripeCustomerId;
  const created = await stripe.customers.create({
    name: found.name,
    email: found.email,
    metadata: { kerb_env: kerbEnv(), kerb_customer_id: customerId },
  });
  await setStripeCustomerId(tx, customerId, created.id);
  return created.id;
}

/** Annual, dearer: an embedded Checkout for the top-up; the change waits for its payment */
export async function startTopUp(
  tx: Tx,
  changeId: string,
  stored: StoredPolicy,
  change: PolicyChangeRequest,
  priced: Quoted,
  deps: SettleDeps,
): Promise<{ clientSecret: string }> {
  const { stripe, now } = deps;
  const { reference } = stored.policy;
  const tags = { kerb_env: kerbEnv(), policy_change_id: changeId };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      ui_mode: "embedded_page",
      allowed_payment_method_types: ["card"],
      customer: await stripeCustomerFor(tx, stored.policy.customerId, stripe),
      expires_at: Math.floor(now.getTime() / 1000) + SESSION_SECONDS,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: priced.amountPence,
            product_data: { name: `Change to ${reference}: ${KIND_LABEL[change.kind]}` },
          },
        },
      ],
      metadata: tags,
      payment_intent_data: { metadata: tags },
      return_url: `${authUrls(getAuthEnv()).baseURL}/account/policies/${reference}?change=${changeId}`,
    } as Stripe.Checkout.SessionCreateParams,
    { idempotencyKey: `policy-change-topup:${changeId}` },
  );
  if (!session.client_secret) throw new Error("Stripe returned a session without a secret");
  await updatePolicyChange(tx, changeId, {
    status: "awaiting_payment",
    stripeSessionId: session.id,
  });
  return { clientSecret: session.client_secret };
}

/** Refunds `pence` from the payment intents in order, each up to what it has left */
async function refund(
  tx: Tx,
  changeId: string,
  stored: StoredPolicy,
  pence: number,
  stripe: StripeClient,
): Promise<void> {
  let left = pence;
  let refundId: string | null = null;
  for (const id of await refundablePaymentIntents(tx, stored.policy.quoteId, stored.policy.id)) {
    if (left <= 0) break;
    const intent = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
    const charge = intent.latest_charge as Stripe.Charge | string | null;
    const refunded = charge && typeof charge !== "string" ? charge.amount_refunded : 0;
    const available = intent.amount - refunded;
    if (available <= 0) continue;
    const amount = Math.min(left, available);
    const made = await stripe.refunds.create(
      { payment_intent: id, amount },
      { idempotencyKey: `policy-change-refund:${changeId}:${id}` },
    );
    refundId ??= made.id;
    left -= amount;
  }
  if (left > 0) throw new Error(`Refund for change ${changeId} is ${left}p short`);
  await updatePolicyChange(tx, changeId, { stripeRefundId: refundId });
}

/** Monthly: the remaining instalments and the subscription's price, moved by `deltaPence` */
async function moveInstalments(
  tx: Tx,
  changeId: string,
  stored: StoredPolicy,
  deltaPence: number,
  stripe: StripeClient,
): Promise<void> {
  const subscriptionId = await shiftScheduledInstalments(tx, stored.policy.quoteId, deltaPence);
  if (!subscriptionId) throw new Error(`No subscription for change ${changeId}`);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = subscription.items.data[0];
  if (!item) throw new Error("Stripe returned a subscription without an item");
  await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [
        {
          id: item.id,
          price_data: {
            currency: "gbp",
            // A subscription item takes a product id, not product_data
            product: idOf(item.price.product as string | { id: string })!,
            unit_amount: Math.max(1, (item.price.unit_amount ?? 0) + deltaPence),
            recurring: { interval: "month" },
          },
        },
      ],
      proration_behavior: "none",
    },
    { idempotencyKey: `policy-change-instalments:${changeId}` },
  );
}

/** After an applied change: the refund (annual) or the new instalments (monthly) */
export async function settleApplied(
  tx: Tx,
  changeId: string,
  stored: StoredPolicy,
  priced: Quoted,
  deps: SettleDeps,
): Promise<void> {
  if (priced.settlement === "refund") {
    await refund(tx, changeId, stored, priced.amountPence, deps.stripe);
  } else if (priced.settlement === "instalments") {
    await moveInstalments(tx, changeId, stored, priced.amountPence, deps.stripe);
  }
}

/**
 * checkout.session.completed for a top-up, in its own transaction: applies the change once, or
 * refunds the payment in full when the change can't be made any more
 */
export async function completeTopUp(sessionId: string, deps: SettleDeps): Promise<void> {
  const { stripe, now } = deps;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") return;
  const paymentIntent = idOf(session.payment_intent);
  await withTx(checkoutDb(), async (tx) => {
    const row = await lockChangeBySession(tx, sessionId);
    if (!row) {
      console.warn("[stripe] checkout.session.completed: no policy change for the session");
      return;
    }
    if (row.status === "applied" || row.status === "failed") return;

    const fail = async (reason: string) => {
      const made = paymentIntent
        ? await stripe.refunds.create(
            { payment_intent: paymentIntent },
            { idempotencyKey: `policy-change-topup-refund:${row.id}` },
          )
        : null;
      await updatePolicyChange(tx, row.id, {
        status: "failed",
        failureReason: reason,
        stripePaymentIntentId: paymentIntent,
        stripeRefundId: made?.id ?? null,
      });
    };

    if (row.status !== "awaiting_payment") return fail("abandoned");
    const stored = await loadPolicyForChange(tx, row.policyId);
    if (!stored || stored.policy.version !== row.fromVersion) return fail("version_moved");
    const today = todayIso(now);
    if (stored.policy.status !== "active" || today >= stored.policy.endsOn) return fail("refused");
    const change = row.request as PolicyChangeRequest;
    const priced = priceChange(
      stored,
      change,
      await getRatingTables(tx, stored.ratingVersionId),
      today,
    );
    if (priced.outcome !== "quoted") return fail("refused");
    await updatePolicyChange(tx, row.id, { stripePaymentIntentId: paymentIntent });
    await changePolicy(tx, { stored, change, priced, changeId: row.id, actor: null, now });
  });
}

/** checkout.session.expired for a top-up: the change is abandoned */
export async function expireTopUp(tx: Tx, sessionId: string): Promise<boolean> {
  const row = await lockChangeBySession(tx, sessionId);
  if (!row) return false;
  if (row.status === "awaiting_payment") {
    await updatePolicyChange(tx, row.id, { status: "abandoned" });
  }
  return true;
}
