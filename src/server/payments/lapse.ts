import type Stripe from "stripe";

import { todayIso } from "#/features/quote/schemas/dates";
import { audit } from "#/server/audit/audit";
import { logSafeError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import {
  customerContact,
  lapsedPoliciesSince,
  lockPaymentsForSubscription,
  lockPoliciesForSubscription,
  markInstalment,
  setPolicyStatus,
  subscriptionForQuote,
  type PaymentRow,
  type PolicyRow,
} from "#/server/data/checkout-rows";
import type { Db } from "#/server/data/job-rows";
import { withTx, type Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { queueEmail, runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";

import { getStripe, type StripeClient } from "./stripe";

// A monthly policy's cover when its payments stop (5.6b, decision 8): active → lapsed when Stripe
// gives up (unpaid), lapsed → active once what was owed is paid (Kerb's rows say so, ruling R18,
// not Stripe's subscription status), and active or lapsed → cancelled
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

/** The subscription's payment rows and policies, locked in that order */
async function lockSubscription(
  tx: Tx,
  subscriptionId: string,
): Promise<{ rows: PaymentRow[]; policies: PolicyRow[] }> {
  const rows = await lockPaymentsForSubscription(tx, subscriptionId);
  return { rows, policies: await lockPoliciesForSubscription(tx, subscriptionId) };
}

/**
 * An instalment the customer owes: `failed`, and not a month Kerb voided for want of cover
 * (`voided_at`). Voided months stay failed for good, so this, not a date, is what keeps a month
 * voided in an earlier lapse from blocking a later resume.
 */
export const isOwed = (row: PaymentRow): boolean => row.status === "failed" && !row.voidedAt;

/**
 * Has the customer paid what they owed while covered (ruling R18)? True when no instalment is
 * owed (isOwed). Which months were covered is decided once, by the void's timestamp comparison
 * against lapsed_at (voidUncoveredInvoice), so there's one boundary. Kerb's own rows decide, not
 * Stripe's subscription status: that follows the newest invoice, which Kerb may have voided, so it
 * can say `active` with nothing paid, or stay `unpaid` once the older invoice is.
 */
export function owedPaid(rows: PaymentRow[]): boolean {
  return !rows.some(isOwed);
}

/** The instalment row an invoice is for: by its id, else by its line's period (ruling R14) */
export function rowForInvoice(rows: PaymentRow[], invoice: Stripe.Invoice): PaymentRow | null {
  const byId = rows.find((row) => row.stripeInvoiceId === invoice.id);
  if (byId) return byId;
  const start = invoice.lines?.data[0]?.period.start;
  if (start === undefined) return null;
  const dueOn = todayIso(new Date(start * 1000));
  return rows.find((row) => row.dueOn === dueOn) ?? null;
}

/**
 * Voids an invoice for a month with no cover: one whose line period starts at or after
 * `lapsedSince` (ms). A draft is finalised first with auto_advance off, so Stripe never tries to
 * charge it in the moment before the void. True when the invoice is now void (or already was);
 * false when it's left alone (an earlier month's, owed from while covered; no line to go by; or
 * paid or uncollectible, where Stripe has moved on).
 */
export async function voidUncoveredInvoice(
  stripe: StripeClient,
  invoice: Stripe.Invoice,
  lapsedSince: number,
): Promise<boolean> {
  const start = invoice.lines?.data[0]?.period.start;
  if (start === undefined || start * 1000 < lapsedSince) return false;
  if (invoice.status === "draft") {
    await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
  }
  if (invoice.status === "draft" || invoice.status === "open") {
    await stripe.invoices.voidInvoice(invoice.id);
    return true;
  }
  return invoice.status === "void";
}

/**
 * A voided month's row → failed, stamped voided_at, so it's never owed. Never replacing another
 * invoice's id (nor stamping a row that holds one: that invoice is the row's), nor a payment.
 */
export async function markVoidedMonth(
  tx: Tx,
  row: PaymentRow | null,
  invoiceId: string,
  at: Date,
): Promise<void> {
  if (!row || row.status === "succeeded") return;
  const ours = row.stripeInvoiceId === null || row.stripeInvoiceId === invoiceId;
  await markInstalment(tx, row.id, {
    status: "failed",
    paidAt: null,
    ...(row.stripeInvoiceId === null ? { stripeInvoiceId: invoiceId } : {}),
    ...(ours && !row.voidedAt ? { voidedAt: at } : {}),
  });
}

/**
 * The lapse's sweep (ruling R18): every draft or open invoice on the subscription for a month
 * from the lapse on is voided, so an invoice.created handled while the policy was still active
 * (and so left alone) doesn't stay chargeable. With invoice.created voiding the ones made after,
 * the order Stripe's events arrive in doesn't matter.
 */
async function voidMonthsSinceLapse(
  tx: Tx,
  subscriptionId: string,
  rows: PaymentRow[],
  lapsedAt: Date,
  stripe: StripeClient,
  now: Date,
): Promise<void> {
  for (const status of ["draft", "open"] as const) {
    const listed = await stripe.invoices.list({ subscription: subscriptionId, status, limit: 100 });
    for (const { id } of listed.data) {
      if (!id) continue;
      // Fetched again: the list's copy may not carry its lines
      const invoice = await stripe.invoices.retrieve(id);
      if (await voidUncoveredInvoice(stripe, invoice, lapsedAt.getTime())) {
        await markVoidedMonth(tx, rowForInvoice(rows, invoice), invoice.id, now);
      }
    }
  }
}

/**
 * Every active policy on the subscription → lapsed at `lapsedAt` (Stripe's time), and the months
 * since voided at Stripe; the email ids
 */
export async function lapseSubscription(
  tx: Tx,
  subscriptionId: string,
  lapsedAt: Date,
  now: Date,
  stripe: StripeClient,
): Promise<number[]> {
  const { rows, policies } = await lockSubscription(tx, subscriptionId);
  const moving = policies.filter((p) => p.status === "active");
  if (moving.length === 0) return [];
  for (const policy of moving) {
    await setPolicyStatus(tx, policy.id, "lapsed", { lapsedAt });
    await audit(tx, {
      actor: null,
      action: "policy.lapsed",
      entityId: policy.id,
      changes: { from: "active", to: "lapsed", lapsedAt: lapsedAt.toISOString() },
    });
  }
  await voidMonthsSinceLapse(tx, subscriptionId, rows, lapsedAt, stripe, now);
  return emailOnce(tx, moving, "cover_lapsed", now);
}

/**
 * Every lapsed policy on the subscription whose owed instalment is paid (owedPaid) → active; the
 * email ids. Whatever Stripe's subscription status says (ruling R18). A cancelled policy is never
 * touched.
 */
export async function resumeSubscription(
  tx: Tx,
  subscriptionId: string,
  now: Date,
): Promise<number[]> {
  const { rows, policies } = await lockSubscription(tx, subscriptionId);
  const paidUp = policies.filter((p) => p.status === "lapsed" && owedPaid(rows));
  return resumePolicies(tx, paidUp, now);
}

/** Lapsed policies (locked by the caller) → active, audited; the one cover_resumed email */
async function resumePolicies(tx: Tx, lapsed: PolicyRow[], now: Date): Promise<number[]> {
  if (lapsed.length === 0) return [];
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
  const moving = (await lockSubscription(tx, subscriptionId)).policies.filter(
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
export async function emailOnce(
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
  /** Lapsed long enough, but what was owed is paid (a resume Kerb missed), so resumed */
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
 * Kerb's rows decide (ruling R18), whatever Stripe's status says: a lapsed policy whose owed
 * instalment is paid (a resume Kerb missed) resumes instead, and nothing is cancelled.
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
    const { rows, policies } = await lockSubscription(tx, subscriptionId);
    if (!policies.some(due)) return nothing;

    const paidUp = policies.filter((p) => p.status === "lapsed" && owedPaid(rows));
    if (paidUp.length > 0) {
      const [emailJob = null] = await resumePolicies(tx, paidUp, now);
      return { cancelled: 0, resumed: paidUp.length, emailJob };
    }
    const client = stripe();
    const subscription = await client.subscriptions.retrieve(subscriptionId);
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
