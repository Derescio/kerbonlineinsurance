import type Stripe from "stripe";

import {
  isKnownQuote,
  lockCheckoutBySessionId,
  lockPaymentsForSubscription,
  lockPoliciesForSubscription,
  markCheckout,
  markInstalment,
  subscriptionsForStripeCustomer,
  type PaymentRow,
} from "#/server/data/checkout-rows";
import type { Tx } from "#/server/db/tx";
import type { JobDeps } from "#/server/jobs/types";
import { fulfilCheckout } from "#/server/quote/fulfil";

import {
  cancelSubscriptionPolicies,
  emailOnce,
  lapseSubscription,
  markVoidedMonth,
  queueBillingEmail,
  resumeSubscription,
  rowForInvoice,
  voidUncoveredInvoice,
} from "./lapse";
import type { StripeClient } from "./stripe";

// What Kerb does for each Stripe event (5.6b, decision 7), one entry per event type. Each entry
// says where the event's object carries its `kerb_env` tag and how the event is handled:
//
// - `handle(tx, event, deps)` runs in the webhook's transaction, after the event id has been
//   recorded in stripe_events (the gate: a repeat delivery waits for the first, then finds the id
//   and does nothing). A throw rolls the record back, so Stripe retries.
// - `ownTransaction(event, deps)` is for checkout.session.completed only: fulfilCheckout opens its
//   own transaction and is idempotent by locking the checkout row, so the event is recorded after
//   it succeeds (ruling R3).
//
// Handlers work from Stripe's current state: each fetches the invoice again before acting. Emails a
// handler queues are returned, so the webhook sends them once the transaction has committed.

export interface HandlerDeps {
  stripe: StripeClient;
  /** The server's time, for rows Kerb stamps itself; Stripe's own times come from the objects */
  now: Date;
  jobs?: JobDeps;
}

/** What a handler leaves for after the commit */
export interface HandlerResult {
  /** Email jobs to run soon (they're retried by the cron if that fails) */
  emailJobs?: number[];
}

type EventOf<T extends Stripe.Event["type"]> = Extract<Stripe.Event, { type: T }>;

/** The event's `kerb_env` tag; null when the object has none */
export type KerbEnvOf<E> = (event: E, deps: HandlerDeps) => string | null | Promise<string | null>;

export type EventEntry<E> =
  | {
      kerbEnv: KerbEnvOf<E>;
      handle: (tx: Tx, event: E, deps: HandlerDeps) => Promise<HandlerResult | void>;
    }
  | { kerbEnv: KerbEnvOf<E>; ownTransaction: (event: E, deps: HandlerDeps) => Promise<void> };

// ---- Where each kind of object keeps its kerb_env (ruling R4) --------------------------------

const tag = (metadata: Stripe.Metadata | null | undefined): string | null =>
  metadata?.kerb_env || null;

/** A Checkout Session's own metadata */
export const sessionKerbEnv = (event: { data: { object: Stripe.Checkout.Session } }) =>
  tag(event.data.object.metadata);

/** An invoice's: the subscription's metadata, snapshotted under parent.subscription_details */
export const invoiceKerbEnv = (event: { data: { object: Stripe.Invoice } }) =>
  tag(event.data.object.parent?.subscription_details?.metadata);

/** A subscription's own metadata */
export const subscriptionKerbEnv = (event: { data: { object: Stripe.Subscription } }) =>
  tag(event.data.object.metadata);

/** A customer's own metadata (startCheckout tags every Stripe customer it makes) */
export const customerKerbEnv = (event: { data: { object: Stripe.Customer } }) =>
  tag(event.data.object.metadata);

/** A payment method carries no Kerb metadata: its customer's, retrieved */
export async function paymentMethodKerbEnv(
  event: { data: { object: Stripe.PaymentMethod } },
  deps: HandlerDeps,
): Promise<string | null> {
  const customerId = idOf(event.data.object.customer);
  if (!customerId) return null;
  const customer = await deps.stripe.customers.retrieve(customerId);
  return customer.deleted ? null : tag(customer.metadata);
}

// ---- Instalments -----------------------------------------------------------------------------

/** A Stripe event Kerb can't act on yet or can't place; a 500, so Stripe tries again later */
export class StripeEventNotReady extends Error {
  override name = "StripeEventNotReady";
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

/** The subscription an invoice bills, from this API version's parent.subscription_details */
const subscriptionOf = (invoice: Stripe.Invoice): string | null =>
  idOf(invoice.parent?.subscription_details?.subscription);

/**
 * The instalment row an invoice pays, its subscription's rows locked: by the invoice id once a
 * row has it, otherwise by billing period, the London date of the line item's period start being
 * the row's due date (ruling R14; fulfilment dates rows the same way). Never "the next row".
 *
 * With no rows for the subscription (ruling R15), the quote id the subscription was tagged with
 * decides. A quote, or a checkout for it, this database knows means the checkout isn't fulfilled
 * yet: throw, so Stripe retries (Review Focus 4). Nothing known (a database since reset, or
 * another one sharing the tag) is an unknown subscription: null, and the caller does nothing
 * (decision 2), so Stripe doesn't retry for days and disable the endpoint.
 * Rows but no match still throws.
 */
export async function instalmentFor(
  tx: Tx,
  invoice: Stripe.Invoice,
  subscriptionId: string,
): Promise<PaymentRow | null> {
  const rows = await lockPaymentsForSubscription(tx, subscriptionId);
  if (rows.length === 0) {
    const quoteId = invoice.parent?.subscription_details?.metadata?.quote_id;
    if (quoteId && (await isKnownQuote(tx, quoteId))) {
      throw new StripeEventNotReady("The subscription has no instalments yet");
    }
    return null;
  }
  const row = rowForInvoice(rows, invoice);
  if (!row) throw new StripeEventNotReady("No instalment is due on the invoice's period");
  return row;
}

/** The warning for an invoice whose subscription this database doesn't know (ids only) */
function warnUnknownSubscription(event: Stripe.Event): void {
  console.warn(`[stripe] ${event.type} ${event.id}: no instalments or quote for the subscription`);
}

// ---- The handlers ----------------------------------------------------------------------------

async function checkoutCompleted(
  event: EventOf<"checkout.session.completed">,
  deps: HandlerDeps,
): Promise<void> {
  const result = await fulfilCheckout(event.data.object.id, {
    auditActor: null,
    now: deps.now,
    stripe: deps.stripe,
    jobs: deps.jobs,
    // A failure to set cancel_at is a 500, so Stripe retries the event (decision 3)
    cancelAtFailure: "throw",
  });
  // A session from a database since reset, say (decision 2)
  if (result.status === "unknown") {
    console.warn(`[stripe] ${event.type} ${event.id}: no checkout row for the session`);
  }
}

async function checkoutExpired(
  tx: Tx,
  event: EventOf<"checkout.session.expired">,
  deps: HandlerDeps,
): Promise<void> {
  const row = await lockCheckoutBySessionId(tx, event.data.object.id);
  if (!row) {
    console.warn(`[stripe] ${event.type} ${event.id}: no checkout row for the session`);
    return;
  }
  // Only an open row: a completed or refunded one has moved on (markCheckout doesn't guard)
  if (row.status === "open") await markCheckout(tx, row.id, "expired", deps.now);
}

async function invoicePaid(
  tx: Tx,
  event: EventOf<"invoice.paid">,
  deps: HandlerDeps,
): Promise<HandlerResult | void> {
  // The first invoice is payment 1, which fulfilment records
  if (event.data.object.billing_reason === "subscription_create") return;
  const invoice = await deps.stripe.invoices.retrieve(event.data.object.id);
  const subscriptionId = subscriptionOf(invoice);
  if (!subscriptionId) return;

  const row = await instalmentFor(tx, invoice, subscriptionId);
  if (!row) return warnUnknownSubscription(event);
  if (!(row.status === "succeeded" && row.stripeInvoiceId === invoice.id)) {
    // Stripe's paid time, so a test clock's month lines up with the rows
    const paidAt = invoice.status_transitions.paid_at ?? event.created;
    await markInstalment(tx, row.id, {
      status: "succeeded",
      paidAt: new Date(paidAt * 1000),
      stripeInvoiceId: invoice.id,
    });
  }
  // A lapsed policy resumes once what it owed from while covered is paid (decision 8), going by
  // Kerb's rows rather than Stripe's subscription status (ruling R18)
  return { emailJobs: await resumeSubscription(tx, subscriptionId, deps.now) };
}

async function invoicePaymentFailed(
  tx: Tx,
  event: EventOf<"invoice.payment_failed">,
  deps: HandlerDeps,
): Promise<HandlerResult | void> {
  // The checkout's own attempt: a declined card there never becomes a purchase
  if (event.data.object.billing_reason === "subscription_create") return;
  const invoice = await deps.stripe.invoices.retrieve(event.data.object.id);
  // Stale: Stripe has since paid or voided it
  if (invoice.status === "paid" || invoice.status === "void") return;
  const subscriptionId = subscriptionOf(invoice);
  if (!subscriptionId) return;

  const row = await instalmentFor(tx, invoice, subscriptionId);
  if (!row) return warnUnknownSubscription(event);
  if (row.status === "succeeded") return;
  const failedBefore = row.status === "failed" && row.stripeInvoiceId === invoice.id;
  await markInstalment(tx, row.id, {
    status: "failed",
    paidAt: null,
    stripeInvoiceId: invoice.id,
  });
  // One email per failed invoice, however many of Stripe's retries fail (decision 8)
  if (failedBefore) return;
  const jobId = await queueBillingEmail(tx, row.customerId, "payment_failed", deps.now);
  return jobId === null ? undefined : { emailJobs: [jobId] };
}

/**
 * An invoice Stripe made for a lapsed policy's subscription: no cover that month, so no charge.
 * It's finalised (Stripe leaves an unpaid subscription's invoices as drafts) and voided, and that
 * month's instalment row stays or becomes failed. A resume then never pays for it (decision 8).
 */
async function invoiceCreated(
  tx: Tx,
  event: EventOf<"invoice.created">,
  deps: HandlerDeps,
): Promise<void> {
  // The first invoice is the checkout's; its policy doesn't exist yet
  if (event.data.object.billing_reason === "subscription_create") return;
  const invoice = await deps.stripe.invoices.retrieve(event.data.object.id);
  const subscriptionId = subscriptionOf(invoice);
  if (!subscriptionId) return;
  // The payment rows, then the policies (the lock order); only a lapsed policy's invoice is voided
  await lockPaymentsForSubscription(tx, subscriptionId);
  const policies = await lockPoliciesForSubscription(tx, subscriptionId);
  const lapsedSince = policies
    .filter((p) => p.status === "lapsed" && p.lapsedAt !== null)
    .map((p) => p.lapsedAt!.getTime());
  if (lapsedSince.length === 0) return;
  // Only a month that starts once the cover had stopped (R14's period). An earlier month's invoice
  // (a late or retried event for the one that failed while covered) is what the customer owes to
  // resume, so it's left open; with no line to go by, it's left alone too. One Stripe has paid or
  // marked uncollectible has moved on, and invoice.paid records a payment.
  if (!(await voidUncoveredInvoice(deps.stripe, invoice, Math.min(...lapsedSince)))) return;
  await markVoidedMonth(tx, await instalmentFor(tx, invoice, subscriptionId), invoice.id);
}

/**
 * Is anything owed at Stripe: an invoice on the subscription still open (or marked uncollectible)?
 * Once the one owed from while covered is paid and later months are void, nothing is, though
 * Stripe may still have the subscription `unpaid` (ruling R18).
 */
async function owesAtStripe(stripe: StripeClient, subscriptionId: string): Promise<boolean> {
  for (const status of ["open", "uncollectible"] as const) {
    const listed = await stripe.invoices.list({ subscription: subscriptionId, status, limit: 1 });
    if (listed.data.length > 0) return true;
  }
  return false;
}

/**
 * The subscription changed, fetched again. Unpaid (Stripe gave up on a payment) with an invoice
 * still owed: the active policies lapse at the event's time. Whatever the status, a lapsed policy
 * whose owed instalment is paid resumes, as on invoice.paid (ruling R18: Kerb's rows decide, since
 * Stripe's status follows the newest invoice, which Kerb may have voided).
 */
async function subscriptionUpdated(
  tx: Tx,
  event: EventOf<"customer.subscription.updated">,
  deps: HandlerDeps,
): Promise<HandlerResult | void> {
  const subscriptionId = event.data.object.id;
  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  // past_due is the grace period: Stripe is still retrying and the cover stays. An unpaid
  // subscription with nothing owed is one whose owed invoice was paid but which Stripe left
  // unpaid: lapsing it again would undo the resume.
  if (subscription.status === "unpaid" && (await owesAtStripe(deps.stripe, subscriptionId))) {
    const lapsedAt = new Date(event.created * 1000);
    const emailJobs = await lapseSubscription(tx, subscriptionId, lapsedAt, deps.now, deps.stripe);
    // Just lapsed: what's owed can't be paid yet
    if (emailJobs.length > 0) return { emailJobs };
  }
  return { emailJobs: await resumeSubscription(tx, subscriptionId, deps.now) };
}

/**
 * The subscription ended. At its cancel_at the term is simply over; after Kerb's 30-day job every
 * policy is already cancelled. Anything else (cancelled in Stripe's dashboard, say) cancels the
 * policies that are still active or lapsed. A lapsed one's customer gets "Your policy has been
 * cancelled" (once for the subscription); an active one's doesn't, as that email says it was for
 * unpaid payments.
 */
async function subscriptionDeleted(
  tx: Tx,
  event: EventOf<"customer.subscription.deleted">,
  deps: HandlerDeps,
): Promise<HandlerResult | void> {
  const subscriptionId = event.data.object.id;
  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const { cancel_at: cancelAt, ended_at: endedAt } = subscription;
  if (cancelAt !== null && endedAt !== null && endedAt >= cancelAt) return;
  const cancelledAt = new Date((endedAt ?? event.created) * 1000);
  const moved = await cancelSubscriptionPolicies(tx, subscriptionId, cancelledAt);
  const wasLapsed = moved.filter((policy) => policy.status === "lapsed");
  return { emailJobs: await emailOnce(tx, wasLapsed, "policy_cancelled_unpaid", deps.now) };
}

/** A Stripe error that is the card's (declined, say), not Kerb's or Stripe's */
const isCardError = (error: unknown) =>
  (error as { type?: unknown } | null)?.type === "StripeCardError";

/**
 * A new card for a Stripe customer: each of their subscriptions that is `unpaid` gets it as its
 * card, and the invoice that failed while the policy was covered (the earliest of its failed
 * instalments whose invoice is still open; lapsed months' are void) is paid with it. Stripe
 * doesn't retry an unpaid subscription itself. A past_due one is left to Stripe's own retries
 * (Review Focus 5). invoice.paid then resumes the cover.
 */
async function payUnpaidWith(
  tx: Tx,
  stripeCustomerId: string,
  card: string,
  deps: HandlerDeps,
): Promise<void> {
  for (const subscriptionId of await subscriptionsForStripeCustomer(tx, stripeCustomerId)) {
    // Locked first, so the portal's two events for one card (attached, then made the default)
    // apply one after the other: the second finds the invoice paid
    const rows = await lockPaymentsForSubscription(tx, subscriptionId);
    const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.status !== "unpaid") continue;
    await deps.stripe.subscriptions.update(subscriptionId, { default_payment_method: card });

    let owed: string | null = null;
    for (const row of rows) {
      if (row.status !== "failed" || !row.stripeInvoiceId) continue;
      const invoice = await deps.stripe.invoices.retrieve(row.stripeInvoiceId);
      if (invoice.status === "open") {
        owed = invoice.id;
        break;
      }
    }
    if (!owed) {
      console.warn(`[stripe] no open invoice to pay on ${subscriptionId}`);
      continue;
    }
    try {
      await deps.stripe.invoices.pay(
        owed,
        { payment_method: card },
        { idempotencyKey: `kerb-resume-${owed}-${card}` },
      );
    } catch (error) {
      // Declined: Stripe sends invoice.payment_failed, and the customer can try another card
      if (!isCardError(error)) throw error;
      console.warn(`[stripe] the new card on ${subscriptionId} was declined`);
    }
  }
}

/** The customer's default card changed (the portal's "update card") */
async function customerUpdated(
  tx: Tx,
  event: EventOf<"customer.updated">,
  deps: HandlerDeps,
): Promise<void> {
  const previous = event.data.previous_attributes?.invoice_settings;
  if (!previous || !("default_payment_method" in previous)) return;
  const customer = await deps.stripe.customers.retrieve(event.data.object.id);
  if (customer.deleted) return;
  const card = idOf(customer.invoice_settings?.default_payment_method);
  if (!card) return;
  await payUnpaidWith(tx, customer.id, card, deps);
}

/** A card attached to the customer (the portal attaches one before making it the default) */
async function paymentMethodAttached(
  tx: Tx,
  event: EventOf<"payment_method.attached">,
  deps: HandlerDeps,
): Promise<void> {
  const customerId = idOf(event.data.object.customer);
  if (!customerId) return;
  await payUnpaidWith(tx, customerId, event.data.object.id, deps);
}

// ---- The table -------------------------------------------------------------------------------

type EventTable = { [T in Stripe.Event["type"]]?: EventEntry<EventOf<T>> };

export const EVENT_HANDLERS: EventTable = {
  "checkout.session.completed": { kerbEnv: sessionKerbEnv, ownTransaction: checkoutCompleted },
  "checkout.session.expired": { kerbEnv: sessionKerbEnv, handle: checkoutExpired },
  "invoice.paid": { kerbEnv: invoiceKerbEnv, handle: invoicePaid },
  "invoice.payment_failed": { kerbEnv: invoiceKerbEnv, handle: invoicePaymentFailed },
  "invoice.created": { kerbEnv: invoiceKerbEnv, handle: invoiceCreated },
  "customer.subscription.updated": { kerbEnv: subscriptionKerbEnv, handle: subscriptionUpdated },
  "customer.subscription.deleted": { kerbEnv: subscriptionKerbEnv, handle: subscriptionDeleted },
  "customer.updated": { kerbEnv: customerKerbEnv, handle: customerUpdated },
  "payment_method.attached": { kerbEnv: paymentMethodKerbEnv, handle: paymentMethodAttached },
};

/** The entry for an event's type, or undefined for a type Kerb ignores */
export function entryFor(event: Stripe.Event): EventEntry<Stripe.Event> | undefined {
  return (EVENT_HANDLERS as Partial<Record<string, EventEntry<Stripe.Event>>>)[event.type];
}
