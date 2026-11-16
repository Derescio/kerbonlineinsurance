import type { StripeClient } from "./stripe";

/**
 * Expires a Checkout Session at Stripe. `expired` when it is now, or was already (its 30 minutes
 * ran out); `complete` when Stripe has it paid, so it can't be expired and isn't safe to drop. Any
 * other failure is thrown. Starting a new checkout (checkout.ts) and deleting an account
 * (account/delete.ts) both use it.
 */
export async function expireAtStripe(
  stripe: StripeClient,
  stripeSessionId: string,
): Promise<"expired" | "complete"> {
  try {
    await stripe.checkout.sessions.expire(stripeSessionId);
    return "expired";
  } catch (error) {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (session.status === "expired") return "expired";
    if (session.status === "complete") return "complete";
    throw error;
  }
}
