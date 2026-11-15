import Stripe from "stripe";

import { getStripeEnv } from "#/server/env";

// Pinned to the installed stripe package's latest API version. The code reads invoices and
// subscriptions in this version's shape: an invoice's subscription is under
// `parent.subscription_details`, and a subscription's period end is on its item.
export const STRIPE_API_VERSION = "2026-10-28.endive";

// The subset of the Stripe client Kerb uses, so tests can fake it (src/test/stripe-fake.ts).
export interface StripeClient {
  checkout: {
    sessions: Pick<Stripe.Checkout.SessionResource, "create" | "retrieve" | "expire">;
  };
  customers: Pick<Stripe.CustomerResource, "create" | "retrieve">;
  subscriptions: Pick<Stripe.SubscriptionResource, "retrieve" | "update" | "cancel">;
  invoices: Pick<Stripe.InvoiceResource, "retrieve" | "pay" | "finalizeInvoice" | "voidInvoice">;
  refunds: Pick<Stripe.RefundResource, "create">;
  paymentIntents: Pick<Stripe.PaymentIntentResource, "retrieve">;
  paymentMethods: Pick<Stripe.PaymentMethodResource, "retrieve">;
  billingPortal: { sessions: Pick<Stripe.BillingPortal.SessionResource, "create"> };
  testHelpers: { testClocks: Pick<Stripe.TestHelpers.TestClockResource, "create"> };
  webhooks: Pick<Stripe.Webhooks, "constructEvent">;
}

let client: StripeClient | undefined;

// Memoised for the real environment; an explicit source (tests) is checked and built fresh.
export function getStripe(source: Record<string, string | undefined> = process.env): StripeClient {
  if (client && source === process.env) return client;
  const { secretKey } = getStripeEnv(source);
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Stripe secret key must be a test key (sk_test_…).");
  }
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  if (source === process.env) client = stripe;
  return stripe;
}
