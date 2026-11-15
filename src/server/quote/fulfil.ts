import { z } from "zod";

import {
  ACCOUNT_CLOSING,
  ALREADY_BOUGHT,
  NOT_BUYABLE,
  QUOTE_EXPIRED,
} from "#/features/quote/pay-copy";
import { todayIso } from "#/features/quote/schemas/dates";
import { audit } from "#/server/audit/audit";
import type { Actor } from "#/server/auth/actor";
import { AuthzError, logSafeError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import { lockUser } from "#/server/data/account";
import {
  checkoutContext,
  checkoutDb,
  isOwnCheckout,
  lockCheckoutBySessionId,
  markCheckout,
  type CheckoutSessionRow,
} from "#/server/data/checkout-rows";
import { jobsDb } from "#/server/data/job-rows";
import { lockCustomer } from "#/server/data/pay-quote";
import { withTx, type Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { jobDeps } from "#/server/jobs/deps";
import { queueEmail, runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";
import { getStripe, type StripeClient } from "#/server/payments/stripe";

import { purchase } from "./purchase";

// Fulfilling a paid Stripe checkout (5.6b, decision 6). Two callers: the webhook's
// checkout.session.completed (actor null) and the return page (the customer). Both read the
// session from Stripe, then, in one transaction with the checkout_sessions row locked FOR UPDATE,
// rerun 5.6's purchase with the answers the row recorded and Stripe's card and ids. Whoever comes
// second waits on the lock and finds the row fulfilled. A payment Kerb can't honour (the quote
// bought another way, a closing account, a refused quote, an amount that doesn't match) is
// refunded in a second transaction once the first has rolled back. After the commit the email is
// sent and a monthly subscription is told to end after its 12th period.

export type FulfilStatus = "fulfilled" | "already" | "refunded" | "pending" | "unknown";
export interface FulfilResult {
  status: FulfilStatus;
  quoteId?: string;
}

/** What a test swaps (the fakes); each defaults to the real one */
export interface FulfilOptions {
  /** The customer from the return page; null (the system) from the webhook */
  auditActor: Actor | null;
  now?: Date;
  stripe?: StripeClient;
  jobs?: JobDeps;
}

type Session = Awaited<ReturnType<StripeClient["checkout"]["sessions"]["retrieve"]>>;
/** The part of a payment method Kerb keeps: its card's brand and last four */
type PaymentMethodCard = { card?: { brand: string; last4: string } | null };

/** What Stripe took, read from the session before anything is locked */
interface Paid {
  amountPence: number | null;
  card: { brand: string; last4: string };
  paymentIntentId: string | null;
  subscription: { id: string; invoiceId: string | null; periodStart: number } | null;
}

// The refusal lines say what to do on Confirm and pay; the refund email says what happened
const REFUND_REASONS: Record<string, { code: string; words: string }> = {
  [ALREADY_BOUGHT]: { code: "already_bought", words: "You’d already bought this quote." },
  [ACCOUNT_CLOSING]: {
    code: "account_closing",
    words: "Your account is closing, so we can’t sell you a policy.",
  },
  [QUOTE_EXPIRED]: {
    code: "quote_expired",
    words: "Your quote had expired before you started paying.",
  },
  [NOT_BUYABLE]: { code: "not_buyable", words: "This quote can’t be bought online." },
};
const AMOUNT_MISMATCH = {
  code: "amount_mismatch",
  words: "The amount taken didn’t match your quote.",
};
const reasonFor = (message: string) =>
  REFUND_REASONS[message] ?? { code: "refused", words: "We couldn’t complete your purchase." };

const KNOWN_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
};

/** Stripe's "visa" as 5.6 showed it, "Visa"; an unknown brand title-cased; none is "Card" */
function brandName(brand: string | null | undefined): string {
  if (!brand || brand === "unknown") return "Card";
  return KNOWN_BRANDS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

/** The card's brand and last four, from the expanded payment method or Stripe again */
async function cardOf(
  stripe: StripeClient,
  method: string | PaymentMethodCard | null | undefined,
): Promise<{ brand: string; last4: string }> {
  const pm = typeof method === "string" ? await stripe.paymentMethods.retrieve(method) : method;
  return { brand: brandName(pm?.card?.brand), last4: pm?.card?.last4 ?? "0000" };
}

/**
 * The first invoice's payment intent. Since 2025-03-31 an invoice's payments are a list of
 * invoice payments (`invoice.payments`, only when expanded), each naming its payment intent.
 */
async function firstInvoicePaymentIntent(
  stripe: StripeClient,
  invoiceId: string,
): Promise<string | null> {
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  for (const entry of invoice.payments?.data ?? []) {
    const intent = idOf(entry.payment.payment_intent);
    if (intent) return intent;
  }
  return null;
}

/** The amount, card and ids Stripe took for the session */
async function paidFor(stripe: StripeClient, session: Session): Promise<Paid> {
  if (session.subscription) {
    const subscription =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription, {
            expand: ["default_payment_method"],
          })
        : session.subscription;
    // In this API version a subscription's period is on its item
    const item = subscription.items.data[0];
    if (!item) throw new Error("Stripe returned a subscription without an item");
    const invoiceId = idOf(subscription.latest_invoice) ?? idOf(session.invoice);
    return {
      amountPence: item.price.unit_amount,
      card: await cardOf(stripe, subscription.default_payment_method),
      paymentIntentId: invoiceId ? await firstInvoicePaymentIntent(stripe, invoiceId) : null,
      subscription: { id: subscription.id, invoiceId, periodStart: item.current_period_start },
    };
  }
  const intent =
    typeof session.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(session.payment_intent, {
          expand: ["payment_method"],
        })
      : session.payment_intent;
  return {
    amountPence: session.amount_total,
    card: await cardOf(stripe, intent?.payment_method),
    paymentIntentId: intent?.id ?? null,
    subscription: null,
  };
}

/**
 * Stripe's billing time `months` after a subscription's anchor (Unix seconds): the same UTC time
 * that many months on, the anchor's day clamped to the month's end (5.6's instalment-date rule).
 * Stripe bills on the UTC anchor, so the arithmetic is in UTC, never in London dates.
 */
export function billingTime(anchor: number, months: number): number {
  const start = new Date(anchor * 1000);
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const at = Date.UTC(
    year,
    month,
    Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
  );
  return Math.floor(at / 1000);
}

/** The end of the 12th monthly period from a subscription's first period start */
export function twelfthPeriodEnd(periodStart: number): number {
  return billingTime(periodStart, 12);
}

/**
 * The 12 instalments' due dates: the London date of each of Stripe's billing times, so a
 * purchase late on a summer evening (UTC still the day before) dates every row by Stripe's charge
 */
export function stripeInstalmentDates(periodStart: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    todayIso(new Date(billingTime(periodStart, i) * 1000)),
  );
}

/**
 * Locks the session's checkout row, the users row first, as startCheckout and purchase() take
 * them, so a fulfilment and a new checkout for the same customer queue rather than deadlock.
 */
async function lockForFulfil(
  tx: Tx,
  sessionId: string,
): Promise<{ row: CheckoutSessionRow; quoteValidUntil: Date; userId: string } | null> {
  const context = await checkoutContext(tx, sessionId);
  if (!context) return null;
  await lockUser(tx, context.userId, "write");
  const row = await lockCheckoutBySessionId(tx, sessionId);
  return row ? { row, ...context } : null;
}

type Outcome =
  | { kind: "unknown" }
  | { kind: "already" | "refunded"; quoteId: string }
  | { kind: "fulfilled"; quoteId: string; jobId: number }
  | { kind: "refund"; reason: { code: string; words: string } };

/**
 * Cancels the subscription at once, with no proration, so it never charges again. A retry after
 * a rollback finds it cancelled already, which is fine.
 */
async function cancelSubscription(stripe: StripeClient, id: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false });
  } catch (error) {
    const found = await stripe.subscriptions.retrieve(id);
    if (found.status !== "canceled") throw error;
  }
}

/** The refund, in its own transaction: cancel, refund, mark, audit and queue the email */
async function refund(
  sessionId: string,
  paid: Paid,
  reason: { code: string; words: string },
  stripe: StripeClient,
  now: Date,
): Promise<
  { kind: "unknown" } | { kind: "already" | "refunded"; quoteId: string; jobId?: number }
> {
  return withTx(checkoutDb(), async (tx) => {
    const locked = await lockForFulfil(tx, sessionId);
    if (!locked) return { kind: "unknown" as const };
    const { row } = locked;
    // The other caller got here first
    if (row.fulfilledAt) return { kind: "already" as const, quoteId: row.quoteId };
    if (row.status === "refunded") return { kind: "refunded" as const, quoteId: row.quoteId };

    if (paid.subscription) await cancelSubscription(stripe, paid.subscription.id);
    if (!paid.paymentIntentId) throw new Error("No payment intent to refund");
    // The key makes a retry after a rollback the same refund
    await stripe.refunds.create(
      { payment_intent: paid.paymentIntentId },
      { idempotencyKey: `kerb-refund-${sessionId}` },
    );

    await markCheckout(tx, row.id, "refunded", now);
    await audit(tx, {
      actor: null,
      action: "payment.refunded",
      entityId: row.id,
      changes: { reason: reason.code, plan: row.plan, amountPence: paid.amountPence ?? 0 },
    });
    const customer = await lockCustomer(tx, row.customerId);
    if (!customer) throw new AuthzError("NOT_FOUND");
    const jobId = await queueEmail(
      tx,
      {
        to: customer.email,
        template: "payment_refunded",
        params: {
          name: customer.firstName,
          reason: reason.words,
          url: `${authUrls(getAuthEnv()).baseURL}/account`,
        },
      },
      now,
    );
    return { kind: "refunded" as const, quoteId: row.quoteId, jobId };
  });
}

/** Ends a monthly plan after its 12th period. Idempotent; a failure is logged and left for the webhook */
async function endAfterTwelve(stripe: StripeClient, paid: Paid): Promise<void> {
  if (!paid.subscription) return;
  try {
    await stripe.subscriptions.update(paid.subscription.id, {
      cancel_at: twelfthPeriodEnd(paid.subscription.periodStart),
      proration_behavior: "none",
    });
  } catch (error) {
    console.error("[stripe] setting cancel_at failed:", logSafeError(error));
  }
}

/** Sends a queued email after the commit; it never fails the fulfilment */
function sendSoon(jobId: number, jobs: JobDeps | undefined): void {
  try {
    runSoon(jobsDb(), jobId, jobs ?? jobDeps());
  } catch (error) {
    console.error("[stripe] queuing the email run failed:", logSafeError(error));
  }
}

/**
 * Fulfils a Checkout Session once, whoever calls first. `pending` while Stripe hasn't taken the
 * payment, `unknown` for a session Kerb has no row for.
 */
export async function fulfilCheckout(
  sessionId: string,
  opts: FulfilOptions,
): Promise<FulfilResult> {
  const now = opts.now ?? new Date();
  const stripe = opts.stripe ?? getStripe();

  // 1 and 2. The session, its payment, card and subscription
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent.payment_method", "subscription.default_payment_method"],
  });
  if (session.payment_status !== "paid") return { status: "pending" };
  const paid = await paidFor(stripe, session);

  // 3 to 6. The row locked, then the purchase with what it recorded
  const outcome = await withTx(checkoutDb(), async (tx): Promise<Outcome> => {
    const locked = await lockForFulfil(tx, sessionId);
    if (!locked) return { kind: "unknown" };
    const { row, userId, quoteValidUntil } = locked;
    if (row.fulfilledAt) return { kind: "already", quoteId: row.quoteId };
    if (row.status === "refunded") return { kind: "refunded", quoteId: row.quoteId };
    if (paid.amountPence !== row.amountPence) return { kind: "refund", reason: AMOUNT_MISMATCH };

    const plan = row.plan as "annual" | "monthly";
    const result = await purchase(tx, {
      userId,
      customerId: row.customerId,
      quoteId: row.quoteId,
      plan,
      startsOn: row.startsOn,
      detailsConfirmedAt: row.detailsConfirmedAt,
      coverAcknowledgedAt: row.coverAcknowledgedAt,
      card: paid.card,
      stripe: {
        paymentIntentId: paid.paymentIntentId ?? undefined,
        subscriptionId: paid.subscription?.id,
        invoiceId: paid.subscription?.invoiceId ?? undefined,
        // Stripe's billing dates: the first period's start, then a month apart
        instalmentDates: paid.subscription
          ? stripeInstalmentDates(paid.subscription.periodStart)
          : undefined,
      },
      auditActor: opts.auditActor,
      now,
      // Paid in a session that started before the quote expired: honoured in good faith
      allowExpired: row.createdAt < quoteValidUntil,
    });
    if (result.status === "refused") return { kind: "refund", reason: reasonFor(result.message) };
    await markCheckout(tx, row.id, "completed", now);
    return { kind: "fulfilled", quoteId: result.quoteId, jobId: result.jobId };
  });

  // 7. What can't be honoured goes back, now the purchase has rolled back
  if (outcome.kind === "refund") {
    const refunded = await refund(sessionId, paid, outcome.reason, stripe, now);
    if (refunded.kind === "unknown") return { status: "unknown" };
    if (refunded.kind === "refunded" && refunded.jobId) sendSoon(refunded.jobId, opts.jobs);
    return { status: refunded.kind, quoteId: refunded.quoteId };
  }
  if (outcome.kind === "unknown") return { status: "unknown" };

  // 8. After the commit: the email, and a monthly plan told to end after 12 periods. A second
  // caller sets cancel_at again, which is how a failed first attempt is retried.
  if (outcome.kind === "fulfilled") sendSoon(outcome.jobId, opts.jobs);
  if (outcome.kind !== "refunded") await endAfterTwelve(stripe, paid);
  return { status: outcome.kind, quoteId: outcome.quoteId };
}

const confirmInput = z.object({ quoteId: z.uuid(), sessionId: z.string().min(1).max(255) });

/**
 * The return page's fulfilment: the signed-in customer's own session for their own quote, with
 * them as the audit actor. Anyone else's, or a malformed id, is not found.
 */
export async function confirmCheckout(
  actor: Actor | null,
  raw: { quoteId: string; sessionId: string },
  opts: Omit<FulfilOptions, "auditActor"> = {},
): Promise<{ status: FulfilStatus }> {
  if (!actor) throw new AuthzError("UNAUTHENTICATED");
  const input = confirmInput.safeParse(raw);
  if (!input.success || !actor.customerId) throw new AuthzError("NOT_FOUND");
  const own = await isOwnCheckout(checkoutDb(), {
    customerId: actor.customerId,
    quoteId: input.data.quoteId,
    stripeSessionId: input.data.sessionId,
  });
  if (!own) throw new AuthzError("NOT_FOUND");
  const result = await fulfilCheckout(input.data.sessionId, { ...opts, auditActor: actor });
  return { status: result.status };
}
