import { audit } from "#/server/audit/audit";
import { logSafeError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import {
  customerContact,
  lapsedPoliciesSince,
  lockPaymentsForSubscription,
  lockPoliciesForSubscription,
  setPolicyStatus,
  subscriptionForQuote,
  type PolicyRow,
} from "#/server/data/checkout-rows";
import type { Db } from "#/server/data/job-rows";
import { withTx, type Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { queueEmail, runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";

import { getStripe, type StripeClient } from "./stripe";

// A monthly policy's cover when its payments stop (5.6b, decision 8): active → lapsed when Stripe
// gives up (unpaid), lapsed → active once what was owed is paid, and active or lapsed → cancelled
// when the subscription ends early or, from the daily job, 30 days after the lapse.
//
// Each move locks the subscription's payment rows and then its policies (FOR UPDATE), the order
// the webhook's invoice handlers take, and checks each policy's status under that lock: only those
// three moves are made, so a cancelled policy is never reinstated (setPolicyStatus would clear its
// cancelled_at). Each moved policy is audited with actor null; the customer gets one email.

export const LAPSE_CANCEL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type BillingEmail = "payment_failed" | "cover_lapsed" | "cover_resumed" | "policy_cancelled_unpaid";

/** Queues a billing email (name and /account/billing link) to the customer; null with no user */
export async function queueBillingEmail(
  tx: Tx,
  customerId: string,
  template: BillingEmail,
  now: Date,
): Promise<number | null> {
  const contact = await customerContact(tx, customerId);
  if (!contact) return null;
  return queueEmail(
    tx,
    {
      to: contact.email,
      template,
      params: { name: contact.firstName, url: `${authUrls(getAuthEnv()).baseURL}/account/billing` },
    },
    now,
  );
}

/** The subscription's policies, locked after its payment rows */
async function lockSubscription(tx: Tx, subscriptionId: string): Promise<PolicyRow[]> {
  await lockPaymentsForSubscription(tx, subscriptionId);
  return lockPoliciesForSubscription(tx, subscriptionId);
}

/** Every active policy on the subscription → lapsed at `lapsedAt` (Stripe's time); the email ids */
export async function lapseSubscription(
  tx: Tx,
  subscriptionId: string,
  lapsedAt: Date,
  now: Date,
): Promise<number[]> {
  const moving = (await lockSubscription(tx, subscriptionId)).filter((p) => p.status === "active");
  for (const policy of moving) {
    await setPolicyStatus(tx, policy.id, "lapsed", { lapsedAt });
    await audit(tx, {
      actor: null,
      action: "policy.lapsed",
      entityId: policy.id,
      changes: { from: "active", to: "lapsed", lapsedAt: lapsedAt.toISOString() },
    });
  }
  return emailOnce(tx, moving, "cover_lapsed", now);
}

/**
 * Every lapsed policy on the subscription → active, when Stripe has the subscription `active`
 * again; the email ids. Stripe is asked only when a policy is lapsed, unless the caller has just
 * fetched the subscription and passes its status. A cancelled policy is never touched.
 */
export async function resumeSubscription(
  tx: Tx,
  subscriptionId: string,
  stripe: StripeClient,
  now: Date,
  knownStatus?: string,
): Promise<number[]> {
  const lapsed = (await lockSubscription(tx, subscriptionId)).filter((p) => p.status === "lapsed");
  if (lapsed.length === 0) return [];
  const status = knownStatus ?? (await stripe.subscriptions.retrieve(subscriptionId)).status;
  if (status !== "active") return [];
  return resumePolicies(tx, lapsed, now);
}

/** Lapsed policies (locked by the caller) → active, audited; the one cover_resumed email */
async function resumePolicies(tx: Tx, lapsed: PolicyRow[], now: Date): Promise<number[]> {
  for (const policy of lapsed) {
    await setPolicyStatus(tx, policy.id, "active");
    await audit(tx, {
      actor: null,
      action: "policy.resumed",
      entityId: policy.id,
      changes: { from: "lapsed", to: "active" },
    });
  }
  return emailOnce(tx, lapsed, "cover_resumed", now);
}

/**
 * The subscription's active and lapsed policies → cancelled at `cancelledAt`, audited
 * `policy.cancelled_unpaid`. `which` narrows the policies (the daily job: those lapsed long
 * enough). Returns the policies moved; an already cancelled one is left as it is.
 */
export async function cancelSubscriptionPolicies(
  tx: Tx,
  subscriptionId: string,
  cancelledAt: Date,
  which: (policy: PolicyRow) => boolean = () => true,
): Promise<PolicyRow[]> {
  const moving = (await lockSubscription(tx, subscriptionId)).filter(
    (p) => (p.status === "active" || p.status === "lapsed") && which(p),
  );
  for (const policy of moving) {
    await setPolicyStatus(tx, policy.id, "cancelled", { cancelledAt });
    await audit(tx, {
      actor: null,
      action: "policy.cancelled_unpaid",
      entityId: policy.id,
      changes: { from: policy.status, to: "cancelled", cancelledAt: cancelledAt.toISOString() },
    });
  }
  return moving;
}

/** One email for the policies moved (a bundle's share one subscription and one customer) */
async function emailOnce(
  tx: Tx,
  moved: PolicyRow[],
  template: BillingEmail,
  now: Date,
): Promise<number[]> {
  if (moved.length === 0) return [];
  const id = await queueBillingEmail(tx, moved[0]!.customerId, template, now);
  return id === null ? [] : [id];
}

// ---- The daily job: cancel 30 days after the lapse -------------------------------------------

export interface LapseRunResult {
  cancelled: number;
  /** Lapsed long enough, but Stripe has the subscription active again: paid, so resumed */
  resumed: number;
  failed: number;
}

interface LapseOutcome {
  cancelled: number;
  resumed: number;
  emailJob: number | null;
}

/**
 * One due policy's subscription, in its own transaction: cancelled at Stripe (at once, no
 * proration; not again if Stripe already has it cancelled), then every policy on it lapsed since
 * `cutoff` → cancelled. Stripe's customer.subscription.deleted that follows finds them cancelled.
 * A subscription Stripe has `active` again was paid (a resume Kerb missed): its lapsed policies
 * resume instead, and nothing is cancelled.
 */
async function cancelLapsed(
  db: Db,
  policy: { id: string; quoteId: string },
  cutoff: Date,
  now: Date,
  stripe: () => StripeClient,
): Promise<LapseOutcome> {
  const nothing: LapseOutcome = { cancelled: 0, resumed: 0, emailJob: null };
  return withTx(db, async (tx) => {
    const subscriptionId = await subscriptionForQuote(tx, policy.quoteId);
    if (!subscriptionId) {
      // A lapse only ever comes from a subscription; nothing to cancel at Stripe or to match on
      console.warn("[payments] lapsed policy with no subscription:", policy.id);
      return nothing;
    }
    const due = (p: PolicyRow) =>
      p.status === "lapsed" && p.lapsedAt !== null && p.lapsedAt <= cutoff;
    // Lock first and check again: a resume may have committed since the list was read
    const policies = await lockSubscription(tx, subscriptionId);
    if (!policies.some(due)) return nothing;

    const client = stripe();
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    if (subscription.status === "active") {
      const lapsed = policies.filter((p) => p.status === "lapsed");
      const [emailJob = null] = await resumePolicies(tx, lapsed, now);
      return { cancelled: 0, resumed: lapsed.length, emailJob };
    }
    if (subscription.status !== "canceled") {
      await client.subscriptions.cancel(subscriptionId, { prorate: false, invoice_now: false });
    }
    const moved = await cancelSubscriptionPolicies(tx, subscriptionId, now, due);
    const [emailJob = null] = await emailOnce(tx, moved, "policy_cancelled_unpaid", now);
    return { cancelled: moved.length, resumed: 0, emailJob };
  });
}

/**
 * The `payments.lapsed_cancellations` daily job: every policy lapsed for 30 days or more by `now`
 * is cancelled, each subscription in its own transaction, so one failure doesn't stop the rest.
 * Emails are sent after each commit. The caller throws when any failed, so the job is retried.
 */
export async function runLapsedCancellations(
  db: Db,
  now: Date,
  deps: JobDeps,
): Promise<LapseRunResult> {
  const result: LapseRunResult = { cancelled: 0, resumed: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - LAPSE_CANCEL_DAYS * DAY_MS);
  // Built on first use, so a day with nothing lapsed needs no Stripe key
  let client: StripeClient | undefined;
  const stripe = () => (client ??= deps.stripe ?? getStripe());
  for (const policy of await lapsedPoliciesSince(db, cutoff)) {
    let outcome: LapseOutcome;
    try {
      outcome = await cancelLapsed(db, policy, cutoff, now, stripe);
    } catch (error) {
      result.failed++;
      // The policy's id and the error's class only
      console.error("[payments] lapsed cancellation failed:", policy.id, logSafeError(error));
      continue;
    }
    result.cancelled += outcome.cancelled;
    result.resumed += outcome.resumed;
    if (outcome.emailJob !== null) runSoon(db, outcome.emailJob, deps);
  }
  return result;
}
