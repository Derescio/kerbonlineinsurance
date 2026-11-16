import type Stripe from "stripe";

import {
  lockPaymentsForSubscription,
  lockPoliciesForSubscription,
  markInstalment,
  type PaymentRow,
  type PolicyRow,
} from "#/server/data/checkout-rows";
import { withTx, type Tx } from "#/server/db/tx";
import { enqueue } from "#/server/jobs/enqueue";
import { runSoon } from "#/server/jobs/email";
import type { HandlerResult, JobDeps, JobRow } from "#/server/jobs/types";
import type { Db } from "#/server/data/job-rows";

import { lapseSubscription, owedPaid, queueBillingEmail, rowForInvoice } from "./lapse";
import { getStripe, type StripeClient } from "./stripe";

// Charging the months after a resume (5.6b, ruling R21). Once the owed invoice is paid, Stripe
// keeps the subscription `unpaid`, because its most recent invoice is void, and for an unpaid
// subscription it makes each new month's invoice a draft it never finalises or charges. So for a
// policy that is active while Stripe has its subscription unpaid, Kerb finalises the new month's
// invoice and pays it with the subscription's card; once paid, Stripe's most recent invoice is
// settled and the subscription returns to active. A declined card is retried by Kerb itself, the
// `payments.retry_invoice` job, 2, 4 and 6 days after the first failure; after the third failed
// retry the policy lapses as an unpaid lapse does. The retries run on Kerb's clock (the job cron),
// so they're proved by tests, not on a Stripe test clock.

export const RETRY_INVOICE_JOB = "payments.retry_invoice";
/** Kerb's retries after the first failed charge, each RETRY_GAP_MS after the one before */
export const RETRY_ATTEMPTS = 3;
const RETRY_GAP_MS = 2 * 24 * 60 * 60 * 1000;

export interface RetryInvoicePayload {
  invoiceId: string;
  subscriptionId: string;
  /** 1 to RETRY_ATTEMPTS */
  attempt: number;
}

/** A Stripe error that is the card's (declined, say), not Kerb's or Stripe's */
export const isCardError = (error: unknown): boolean =>
  (error as { type?: unknown } | null)?.type === "StripeCardError";

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

/**
 * An instalment's charge failed: the row → failed with the invoice id, and the payment_failed
 * email queued the first time for that invoice only (decision 8), whoever notices first (Kerb's
 * own charge, or Stripe's invoice.payment_failed). A paid row is left alone. The email job ids.
 */
export async function markChargeFailed(
  tx: Tx,
  row: PaymentRow,
  invoiceId: string,
  now: Date,
): Promise<number[]> {
  if (row.status === "succeeded") return [];
  const failedBefore = row.status === "failed" && row.stripeInvoiceId === invoiceId;
  await markInstalment(tx, row.id, { status: "failed", paidAt: null, stripeInvoiceId: invoiceId });
  if (failedBefore) return [];
  const jobId = await queueBillingEmail(tx, row.customerId, "payment_failed", now);
  return jobId === null ? [] : [jobId];
}

/** Queues Kerb's retry `attempt` of the invoice, 2 days on; a second queue of it is a no-op */
async function queueRetry(tx: Tx, payload: RetryInvoicePayload, now: Date): Promise<void> {
  await enqueue(tx, {
    type: RETRY_INVOICE_JOB,
    payload: { ...payload },
    idempotencyKey: `${RETRY_INVOICE_JOB}:${payload.invoiceId}:${payload.attempt}`,
    runAfter: new Date(now.getTime() + RETRY_GAP_MS),
  });
}

/**
 * Pays the invoice with the subscription's card, Kerb's charge number `charge` (1 is the first, at
 * invoice.created; each retry is its attempt + 1), each with its own idempotency key. Throws what
 * Stripe throws.
 */
async function payWithSubscriptionCard(
  stripe: StripeClient,
  invoiceId: string,
  card: string | null,
  charge: number,
): Promise<void> {
  await stripe.invoices.pay(invoiceId, card ? { payment_method: card } : {}, {
    idempotencyKey: `kerb-charge-${invoiceId}-${charge}`,
  });
}

/**
 * invoice.created for a subscription none of whose policies is lapsed (the caller voids a lapsed
 * one's, R20). Charged only after a resume: a policy active, nothing owed, Stripe still saying
 * `unpaid`, and the invoice a draft or open. In the grace period (past_due) Stripe is still
 * retrying, and an active subscription's invoices Stripe charges itself. The email job ids.
 */
export async function chargeResumedMonth(
  tx: Tx,
  invoice: Stripe.Invoice,
  subscriptionId: string,
  rows: PaymentRow[],
  policies: PolicyRow[],
  stripe: StripeClient,
  now: Date,
): Promise<number[]> {
  if (!policies.some((p) => p.status === "active") || !owedPaid(rows)) return [];
  if (invoice.status !== "draft" && invoice.status !== "open") return [];
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.status !== "unpaid") return [];

  if (invoice.status === "draft") {
    // auto_advance off: Kerb charges it, now and on its own retries
    await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
  }
  try {
    await payWithSubscriptionCard(stripe, invoice.id, idOf(subscription.default_payment_method), 1);
    return []; // invoice.paid records the row
  } catch (error) {
    if (!isCardError(error)) throw error;
    const row = rowForInvoice(rows, invoice);
    const emails = row ? await markChargeFailed(tx, row, invoice.id, now) : [];
    await queueRetry(tx, { invoiceId: invoice.id, subscriptionId, attempt: 1 }, now);
    return emails;
  }
}

/**
 * The `payments.retry_invoice` job: Kerb's retry `attempt` of a month charged after a resume, in
 * one transaction with the subscription's payment rows and policies locked (the webhook's order).
 * Nothing to do once the invoice is paid or void, or no policy on it is active. A declined card
 * queues the next retry, and after the last one the policy lapses as an unpaid lapse does
 * (lapsed_at now, audited, the cover_lapsed email, the void sweep); a new card then pays the
 * failed month, which is owed. Any other error throws, so the runner's backoff retries the job.
 */
export async function retryInvoiceHandler(
  job: JobRow,
  { db, deps, now }: { db: Db; deps: JobDeps; now: Date },
): Promise<HandlerResult> {
  const { invoiceId, subscriptionId, attempt } = job.payload as RetryInvoicePayload;
  const stripe = deps.stripe ?? getStripe();
  const emailJobs = await withTx(db, async (tx): Promise<number[] | null> => {
    await lockPaymentsForSubscription(tx, subscriptionId);
    const policies = await lockPoliciesForSubscription(tx, subscriptionId);
    if (!policies.some((p) => p.status === "active")) return null;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status === "paid" || invoice.status === "void") return null;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    try {
      const card = idOf(subscription.default_payment_method);
      await payWithSubscriptionCard(stripe, invoiceId, card, attempt + 1);
      return [];
    } catch (error) {
      if (!isCardError(error)) throw error;
      if (attempt < RETRY_ATTEMPTS) {
        await queueRetry(tx, { invoiceId, subscriptionId, attempt: attempt + 1 }, now);
        return [];
      }
      return lapseSubscription(tx, subscriptionId, now, now, stripe);
    }
  });
  if (emailJobs === null) return { skipped: "paid, void, or no active policy" };
  for (const id of emailJobs) runSoon(db, id, deps);
}
