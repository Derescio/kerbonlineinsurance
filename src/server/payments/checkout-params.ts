import type Stripe from "stripe";

import { kerbEnv } from "#/server/payments/kerb-env";

// Stripe's minimum Session lifetime
const SESSION_SECONDS = 30 * 60;

export interface CheckoutInput {
  quoteId: string;
  plan: "annual" | "monthly";
  amountPence: number;
  lineName: string;
  stripeCustomerId: string;
  baseUrl: string;
  now: Date;
}

// The embedded Checkout Session for a quote (decisions 1 to 3): priced inline, cards only, tagged
// with the environment on the Session and on whatever it creates (payment intent or subscription).
export function checkoutParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  const monthly = input.plan === "monthly";
  const tags = { kerb_env: kerbEnv() };
  return {
    mode: monthly ? "subscription" : "payment",
    ui_mode: "embedded",
    // v23 renamed it: a filter on the eligible methods, so cards only
    allowed_payment_method_types: ["card"],
    customer: input.stripeCustomerId,
    expires_at: Math.floor(input.now.getTime() / 1000) + SESSION_SECONDS,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: input.amountPence,
          product_data: { name: input.lineName },
          ...(monthly ? { recurring: { interval: "month" as const } } : {}),
        },
      },
    ],
    metadata: { ...tags, quote_id: input.quoteId },
    ...(monthly
      ? { subscription_data: { metadata: { ...tags, quote_id: input.quoteId } } }
      : { payment_intent_data: { metadata: { ...tags, quote_id: input.quoteId } } }),
    return_url: `${input.baseUrl}/quote/covered/${input.quoteId}?session_id={CHECKOUT_SESSION_ID}`,
  };
}
