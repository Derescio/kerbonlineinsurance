import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { StripeCheckout } from "./StripeCheckout";

// Stripe's embedded form for Confirm and pay (5.6b, decisions 1 and 10). Stripe itself is never
// loaded: the two packages are stand-ins that show what they were given.

const stripe = vi.hoisted(() => ({ loadStripe: vi.fn() }));
vi.mock("@stripe/stripe-js", () => stripe);
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({
    stripe: instance,
    options,
    children,
  }: {
    stripe: unknown;
    options: { clientSecret: string };
    children: ReactNode;
  }) => (
    <div data-testid="provider" data-secret={options.clientSecret} data-stripe={String(instance)}>
      {children}
    </div>
  ),
  EmbeddedCheckout: () => <div data-testid="embedded-checkout" />,
}));

beforeEach(() => {
  stripe.loadStripe.mockReset().mockReturnValue("stripe-instance");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("StripeCheckout", () => {
  it("mounts Stripe's embedded form with the publishable key and the session's secret", async () => {
    vi.stubEnv("VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_kerb");
    await render(<StripeCheckout clientSecret="cs_test_1_secret" />);
    await expect.element(page.getByTestId("embedded-checkout")).toBeInTheDocument();
    await expect
      .element(page.getByTestId("provider"))
      .toHaveAttribute("data-secret", "cs_test_1_secret");
    await expect
      .element(page.getByTestId("provider"))
      .toHaveAttribute("data-stripe", "stripe-instance");
    expect(stripe.loadStripe).toHaveBeenCalledWith("pk_test_kerb");
  });

  it("shows a plain error, and loads nothing, without a publishable key", async () => {
    vi.stubEnv("VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
    await render(<StripeCheckout clientSecret="cs_test_1_secret" />);
    await expect
      .element(page.getByText("Payments aren’t set up here yet, so this quote can’t be paid."))
      .toBeVisible();
    expect(stripe.loadStripe).not.toHaveBeenCalled();
    expect(page.getByTestId("embedded-checkout").elements()).toHaveLength(0);
  });
});
