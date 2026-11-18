import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { Alert } from "#/components/feedback/Alert";

// Stripe's embedded Checkout form (5.6b, decisions 1 and 10), for one Checkout Session's client
// secret. Confirm and pay imports this module lazily, so Stripe's JS loads only there, and only
// once "Continue to payment" has a session. A new secret is a new form: the provider can't change
// its secret, so it's keyed on it. The key is a publishable test key (pk_test_…); without one the
// page says so rather than failing inside Stripe.

/** The plain error when the publishable key isn't set */
export const NO_STRIPE_KEY = "Payments aren’t set up here yet, so this quote can’t be paid.";

// loadStripe adds Stripe's script once per key; keep its promise rather than asking again
const loaded = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string): Promise<Stripe | null> {
  let promise = loaded.get(key);
  if (!promise) {
    promise = loadStripe(key);
    loaded.set(key, promise);
  }
  return promise;
}

export function StripeCheckout({ clientSecret }: { clientSecret: string }) {
  const key = import.meta.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY as string | undefined;
  if (!key) {
    return (
      <Alert tone="warning">
        <p>{NO_STRIPE_KEY}</p>
      </Alert>
    );
  }
  return (
    <EmbeddedCheckoutProvider key={clientSecret} stripe={stripeFor(key)} options={{ clientSecret }}>
      <EmbeddedCheckout className="quote-stripe" />
    </EmbeddedCheckoutProvider>
  );
}
