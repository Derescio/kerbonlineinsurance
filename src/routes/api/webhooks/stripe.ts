import { createFileRoute } from "@tanstack/react-router";

import { logSafeError } from "#/server/auth/errors";
import { getStripeEnv } from "#/server/env";
import { getStripe } from "#/server/payments/stripe";
import { handleStripeWebhook } from "#/server/payments/webhook";

// Stripe's webhook (5.6b, decision 7): checkout, invoice and subscription events, checked against
// STRIPE_WEBHOOK_SECRET and acted on once (src/server/payments/webhook.ts). POST only, as Stripe
// calls it; no auth middleware, since the signature is the authentication.

function post({ request }: { request: Request }): Promise<Response> {
  let deps;
  try {
    deps = { stripe: getStripe(), webhookSecret: getStripeEnv().webhookSecret };
  } catch (error) {
    // A missing or live key: 503, so Stripe retries once it's fixed
    console.error("[stripe] webhook not configured:", logSafeError(error));
    return Promise.resolve(
      Response.json(
        { error: "not configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    );
  }
  return handleStripeWebhook(request, deps);
}

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: { handlers: { POST: post } },
});
