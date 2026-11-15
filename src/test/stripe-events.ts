import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { completeJourney } from "#/features/quote/journey-fixtures";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { getCatalogue } from "#/server/data/reference";
import { getDb } from "#/server/db/client";
import { checkoutSessions } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { STRIPE_API_VERSION } from "#/server/payments/stripe";
import { startCheckout } from "#/server/quote/checkout";
import { saveCarQuoteFor } from "#/server/quote/save";

import { makeUser } from "./factories";
import type { fakeStripe } from "./stripe-fake";

// Stripe webhook events for integration tests (5.6b): events built as Stripe sends them, signed
// with the real library's test header, and the checkout a webhook test starts from (a priced car
// quote with a session started at the fake Stripe).

type FakeStripe = ReturnType<typeof fakeStripe>;
type Obj = Record<string, unknown>;

export const TEST_WEBHOOK_SECRET = "whsec_test_kerb_webhook";

/** An event as Stripe delivers it; `created` is Unix seconds (default now) */
export function stripeEvent(type: string, object: Obj, extra: Obj = {}): Obj {
  return {
    id: `evt_test_${randomUUID().replaceAll("-", "")}`,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
    ...extra,
  };
}

/**
 * The POST Stripe makes: the event's JSON with a `Stripe-Signature` header from the real
 * `generateTestHeaderString`, so the route's real `constructEvent` checks it
 */
export function signedRequest(event: Obj, secret = TEST_WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
}

/** A Checkout Session event's object: the session id and its kerb_env tag */
export function sessionObject(sessionId: string, kerbEnv: string | null = "local"): Obj {
  return {
    id: sessionId,
    object: "checkout.session",
    metadata: kerbEnv === null ? {} : { kerb_env: kerbEnv },
  };
}

export interface InvoiceShape {
  id: string;
  subscriptionId: string;
  /** The line item's period start (Unix seconds); omit for an invoice with no lines */
  periodStart?: number;
  billingReason?: string;
  status?: string;
  /** Unix seconds */
  paidAt?: number | null;
  kerbEnv?: string | null;
}

/** An invoice as this API version shapes it: the subscription under parent.subscription_details */
export function invoiceObject(shape: InvoiceShape): Obj {
  const kerbEnv = shape.kerbEnv === undefined ? "local" : shape.kerbEnv;
  return {
    id: shape.id,
    object: "invoice",
    billing_reason: shape.billingReason ?? "subscription_cycle",
    status: shape.status ?? "paid",
    status_transitions: {
      finalized_at: null,
      marked_uncollectible_at: null,
      paid_at: shape.paidAt ?? null,
      voided_at: null,
    },
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        subscription: shape.subscriptionId,
        metadata: kerbEnv === null ? {} : { kerb_env: kerbEnv },
      },
    },
    lines: {
      object: "list",
      data:
        shape.periodStart === undefined
          ? []
          : [
              {
                id: `il_${shape.id}`,
                period: { start: shape.periodStart, end: shape.periodStart },
              },
            ],
    },
  };
}

/** The invoice preset at the fake (what a fresh retrieve returns) and its event object */
export function presetInvoice(stripe: FakeStripe, shape: InvoiceShape): Obj {
  const invoice = invoiceObject(shape);
  stripe.set("invoices.retrieve", shape.id, invoice);
  return invoice;
}

/** A priced car quote (the Golf from the catalogue) saved for a new customer */
export async function pricedCarQuote(now: Date): Promise<{ actor: Actor; quoteId: string }> {
  const user = await makeUser();
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  const saved = await withTx(getDb(), async (tx) => saveCarQuoteFor(tx, user.id, { journey, now }));
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, quoteId: saved.quoteId };
}

/** A checkout started at the fake Stripe for the quote; returns its checkout_sessions row */
export async function startedCheckout(
  stripe: FakeStripe,
  actor: Actor,
  quoteId: string,
  { plan = "monthly", now, startsOn }: { plan?: "annual" | "monthly"; now: Date; startsOn: string },
) {
  const result = await startCheckout(
    actor,
    {
      input: { quoteId, plan, startsOn, detailsConfirmed: true, coverAcknowledged: true },
      idempotencyKey: randomUUID(),
    },
    { headers: new Headers() },
    { stripe, testClocks: false, now },
  );
  if (!result.ok) throw new Error("checkout not started");
  const [row] = await getDb()
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.id, result.data.checkoutId));
  return row!;
}

/**
 * Stripe's paid subscription session, as fulfilCheckout retrieves it: the subscription expanded
 * with its card and first period, and the first invoice with its payment intent
 */
export function paidMonthlySession(
  stripe: FakeStripe,
  sessionId: string,
  amount: number,
  periodStart: number,
): { subscriptionId: string; invoiceId: string } {
  const subscriptionId = `sub_for_${sessionId}`;
  const invoiceId = `in_for_${sessionId}`;
  stripe.set("checkout.sessions.retrieve", sessionId, {
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    amount_total: amount,
    payment_intent: null,
    invoice: invoiceId,
    subscription: {
      id: subscriptionId,
      object: "subscription",
      status: "active",
      latest_invoice: invoiceId,
      default_payment_method: {
        id: "pm_test_2",
        object: "payment_method",
        card: { brand: "mastercard", last4: "4444" },
      },
      items: {
        object: "list",
        data: [
          {
            id: "si_test_1",
            current_period_start: periodStart,
            current_period_end: periodStart + 30 * 86_400,
            price: { unit_amount: amount, recurring: { interval: "month" } },
          },
        ],
      },
    },
  });
  stripe.set("invoices.retrieve", invoiceId, {
    object: "invoice",
    billing_reason: "subscription_create",
    parent: { subscription_details: { subscription: subscriptionId, metadata: {} } },
    payments: {
      object: "list",
      data: [{ payment: { type: "payment_intent", payment_intent: `pi_for_${invoiceId}` } }],
    },
  });
  return { subscriptionId, invoiceId };
}
