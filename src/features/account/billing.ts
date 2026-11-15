import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

import { userMiddleware } from "#/server/auth/middleware";
import type { BillingPortal } from "#/server/payments/billing";

// The server function behind /account/billing (5.6b, decision 9). The work is in
// src/server/payments/billing.ts; this resolves the signed-in actor and hands over, so the Stripe
// customer is only ever the actor's own. Imported inside the handler, which the client build
// strips, so Stripe and the database stay server-side.

export type { BillingPortal };

/** The line on /account/billing for a customer with no monthly plan (ruling R12) */
export const NO_MONTHLY_CARD = "You don’t pay monthly, so there’s no card to update.";

/** A Stripe portal session's URL for the signed-in customer, or `no_monthly`. Never cached */
export const getBillingPortal = createServerFn({ method: "GET" })
  .middleware([userMiddleware])
  .handler(async ({ context }): Promise<BillingPortal> => {
    setResponseHeader("Cache-Control", "private, no-store");
    const { billingPortalFor } = await import("#/server/payments/billing");
    return billingPortalFor(context.actor);
  });
