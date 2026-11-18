import type { Actor } from "#/server/auth/actor";
import { authUrls } from "#/server/auth/origins";
import { billingCustomer, checkoutDb } from "#/server/data/checkout-rows";
import { getAuthEnv } from "#/server/env";

import { getStripe, type StripeClient } from "./stripe";

// /account/billing (5.6b, decision 9): a Stripe customer-portal session for the signed-in
// customer, where they update their card and see their invoices, returning to /account. The
// Stripe customer comes only from the actor's own customers row, never from the request. A
// customer with no monthly plan has no card on file to update, even when paying in full gave them
// a Stripe customer (ruling R12).

export type BillingPortal = { kind: "portal"; url: string } | { kind: "no_monthly" };

export interface BillingDeps {
  stripe?: StripeClient;
}

export async function billingPortalFor(
  actor: Actor,
  deps: BillingDeps = {},
): Promise<BillingPortal> {
  if (!actor.customerId) return { kind: "no_monthly" };
  const { stripeCustomerId, monthly } = await billingCustomer(checkoutDb(), actor.customerId);
  if (!stripeCustomerId || !monthly) return { kind: "no_monthly" };
  const stripe = deps.stripe ?? getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${authUrls(getAuthEnv()).baseURL}/account`,
  });
  return { kind: "portal", url: session.url };
}
