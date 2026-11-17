import type { FrameLocator, Locator, Page } from "@playwright/test";

// Stripe's embedded Checkout in test mode (5.6b), filled the same way by every buy journey. Its
// inputs' ids are steadier than their labels (the CVC label is shared with an icon). Stripe picks
// the country from where the browser is: on GitHub's US runners it's the United States, which
// turns the postcode into a ZIP ("E8 3RL" becomes "83") and offers Link, which then wants a
// phone. So the country is set to the United Kingdom first and Link is turned off (5.7).

/** Stripe reveals some fields (a postcode) only after others: wait briefly for each */
async function shown(field: Locator): Promise<boolean> {
  try {
    await field.waitFor({ state: "visible", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

async function fillIfShown(field: Locator, value: string) {
  if (await shown(field)) await field.fill(value);
}

export function stripeForm(page: Page): FrameLocator {
  return page.frameLocator('iframe[name="embedded-checkout"]');
}

/** Fills Stripe's form with the card that pays, as a UK customer, and presses Pay */
export async function payWithTestCard(page: Page, details: { name: string; email: string }) {
  const stripe = stripeForm(page);
  await stripe.locator("#cardNumber").fill("4242 4242 4242 4242", { timeout: 60_000 });
  await stripe.locator("#cardExpiry").fill("12 / 30");
  await stripe.locator("#cardCvc").fill("123");
  await fillIfShown(stripe.locator("#billingName"), details.name);
  await fillIfShown(stripe.locator("#email"), details.email);

  const country = stripe.locator("#billingCountry");
  if (await shown(country)) await country.selectOption("GB");
  await fillIfShown(stripe.locator("#billingPostalCode"), "E8 3RL");

  // Link's "save my information" wants a phone number; the test doesn't use Link
  const link = stripe.locator("#enableStripePass");
  if ((await link.count()) > 0 && (await link.isChecked())) {
    await link.uncheck({ force: true });
  }

  await stripe.getByTestId("hosted-payment-submit-button").click();
}
