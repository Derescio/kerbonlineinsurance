import type Stripe from "stripe";

import { todayIso } from "#/features/quote/schemas/dates";
import { authUrls } from "#/server/auth/origins";
import {
  customerContact,
  lockCheckoutBySessionId,
  lockPaymentsForSubscription,
  markCheckout,
  markInstalment,
  type PaymentRow,
} from "#/server/data/checkout-rows";
import type { Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { queueEmail } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";
import { fulfilCheckout } from "#/server/quote/fulfil";

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
// Task 6 adds customer.* (the customer's metadata) and payment_method.attached (the customer,
// retrieved, since a payment method carries no Kerb metadata).

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
 * No rows yet means the checkout isn't fulfilled: throw, so Stripe retries (Review Focus 4).
 */
export async function instalmentFor(
  tx: Tx,
  invoice: Stripe.Invoice,
  subscriptionId: string,
): Promise<PaymentRow> {
  const rows = await lockPaymentsForSubscription(tx, subscriptionId);
  if (rows.length === 0) throw new StripeEventNotReady("The subscription has no instalments yet");
  const byId = rows.find((row) => row.stripeInvoiceId === invoice.id);
  if (byId) return byId;
  const start = invoice.lines?.data[0]?.period.start;
  const dueOn = start === undefined ? null : todayIso(new Date(start * 1000));
  const byPeriod = rows.find((row) => row.dueOn === dueOn);
  if (!byPeriod) throw new StripeEventNotReady("No instalment is due on the invoice's period");
  return byPeriod;
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
): Promise<void> {
  // The first invoice is payment 1, which fulfilment records
  if (event.data.object.billing_reason === "subscription_create") return;
  const invoice = await deps.stripe.invoices.retrieve(event.data.object.id);
  const subscriptionId = subscriptionOf(invoice);
  if (!subscriptionId) return;

  const row = await instalmentFor(tx, invoice, subscriptionId);
  if (row.status === "succeeded" && row.stripeInvoiceId === invoice.id) return;
  // Stripe's paid time, so a test clock's month lines up with the rows
  const paidAt = invoice.status_transitions.paid_at ?? event.created;
  await markInstalment(tx, row.id, {
    status: "succeeded",
    paidAt: new Date(paidAt * 1000),
    stripeInvoiceId: invoice.id,
  });
  // Task 6: a lapsed policy whose subscription is active again resumes here
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
  if (row.status === "succeeded") return;
  const failedBefore = row.status === "failed" && row.stripeInvoiceId === invoice.id;
  await markInstalment(tx, row.id, {
    status: "failed",
    paidAt: null,
    stripeInvoiceId: invoice.id,
  });
  // One email per failed invoice, however many of Stripe's retries fail (decision 8)
  if (failedBefore) return;
  const contact = await customerContact(tx, row.customerId);
  if (!contact) return;
  const jobId = await queueEmail(
    tx,
    {
      to: contact.email,
      template: "payment_failed",
      params: {
        name: contact.firstName,
        url: `${authUrls(getAuthEnv()).baseURL}/account/billing`,
      },
    },
    deps.now,
  );
  return { emailJobs: [jobId] };
}

// ---- The table -------------------------------------------------------------------------------

type EventTable = { [T in Stripe.Event["type"]]?: EventEntry<EventOf<T>> };

export const EVENT_HANDLERS: EventTable = {
  "checkout.session.completed": { kerbEnv: sessionKerbEnv, ownTransaction: checkoutCompleted },
  "checkout.session.expired": { kerbEnv: sessionKerbEnv, handle: checkoutExpired },
  "invoice.paid": { kerbEnv: invoiceKerbEnv, handle: invoicePaid },
  "invoice.payment_failed": { kerbEnv: invoiceKerbEnv, handle: invoicePaymentFailed },
};

/** The entry for an event's type, or undefined for a type Kerb ignores */
export function entryFor(event: Stripe.Event): EventEntry<Stripe.Event> | undefined {
  return (EVENT_HANDLERS as Partial<Record<string, EventEntry<Stripe.Event>>>)[event.type];
}
