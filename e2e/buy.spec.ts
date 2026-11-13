import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { confirmEmailInDatabase, databaseUrl } from "./db";
import { withCompleteJourney } from "./quote-journey";

// Buying a car quote (5.6): a complete journey → Choose cover → the gate, where a guest creates an
// account (the sign-up saves the quote against it, decision 1) → confirm the email → log in to Your
// saved quotes → Confirm and pay, monthly, with the demo card that pays → You're covered → the
// policy on /account → the saved quote shows "Bought". At phone width, with axe on the gate, pay,
// You're covered and Your saved quotes at 390, 768 and 1440 px. Like 4.7's delete test, it needs
// E2E_DATABASE_URL (e2e/db.ts) to confirm its own sign-up, and skips without it.

const PASSWORD = "kerb e2e password 2026";
const PHONE = { width: 390, height: 900 };
const WIDTHS = [390, 768, 1440];

/** axe at phone, tablet and laptop widths (5.4b, call 12), then back to the phone */
async function expectNoSeriousAxeViolationsAtEachWidth(page: Page) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoSeriousAxeViolations(page);
  }
  await page.setViewportSize(PHONE);
}

test("a guest creates an account mid-quote, pays monthly, and finds the policy on their account", async ({
  page,
}) => {
  test.skip(
    !databaseUrl,
    "E2E_DATABASE_URL isn't set, so the run can't confirm the new account's email",
  );
  test.setTimeout(120_000);
  const email = `delivered+e2e-buy-${Date.now()}@resend.dev`;

  await page.setViewportSize(PHONE);
  await withCompleteJourney(page);

  // 1. Your quote → Choose cover → Continue → Continue with car only
  await page.goto("/quote/car?postcode=E8+3RL&step=quote");
  await expect(page.getByRole("heading", { name: "Your Comprehensive price" })).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await expect(page).toHaveURL(/step=cover/);
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
  await expect(page).toHaveURL(/step=add-home/);
  await page.getByRole("button", { name: "Continue with car only" }).click();

  // 2. The gate: sign in first, with a link to create an account
  await expect(page).toHaveURL(/step=buy/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in before you pay" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your cover is waiting" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/auth=signup/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Create your account to continue" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "New to Kerb?" })).toBeVisible();
  // Turnstile's widget can keep the network busy, so wait for its token, not network idle
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await expectNoSeriousAxeViolationsAtEachWidth(page);

  await page.getByLabel("Full name").fill("Alex Morgan");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  await expect(
    page.getByText(
      "Your quote is saved to your new account. Confirm your email, sign in, and you’ll find it under Your saved quotes.",
    ),
  ).toBeVisible();

  // 3. Confirm the email in the database
  await confirmEmailInDatabase(email);

  // 4. Log in, on the way to Your saved quotes
  await page.goto("/login?redirect=/quote/retrieve");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/quote\/retrieve$/);

  // 5. The quote the sign-up saved is ready to buy. The sign-up saves it after its response, so
  // it can land a moment after the login: reload until it's there
  await expect(page.getByRole("heading", { level: 1, name: "Your saved quotes" })).toBeVisible();
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Saved quotes · Alex Morgan")).toBeVisible({ timeout: 2_000 });
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(saved).toContainText("Ready to buy");
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
  await saved.getByRole("link", { name: "Continue quote" }).click();

  // 6. Confirm and pay: monthly, the demo card that pays, both boxes
  await expect(page).toHaveURL(/\/quote\/pay\//);
  await expect(page.getByRole("heading", { level: 1, name: "Confirm and pay" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);

  await page.getByText("Pay monthly").click();
  await expect(page.getByRole("radio", { name: /Pay monthly/ })).toBeChecked();
  await expect(page.getByLabel("Name on card")).toHaveValue("Alex Morgan");
  await page.getByLabel("Card number").fill("4242 4242 4242 4242");
  await page.getByLabel("Expiry (MM / YY)").fill("12/30");
  await page.getByLabel("Security code").fill("123");
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: /^Pay £[\d,]+\.\d{2} today$/ }).click();

  // 7. You're covered, with the policy reference
  await expect(page).toHaveURL(/\/quote\/covered\//);
  await expect(page.getByRole("heading", { level: 1, name: "You’re covered" })).toBeVisible();
  await expect(page.getByText("Payment successful")).toBeVisible();
  const policy = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  await expect(policy).toHaveCount(1);
  const reference = (await policy.getAttribute("aria-label"))!.replace("Policy ", "");
  await expect(policy).toContainText(reference);
  await expect(
    page.getByText(
      /^£[\d,]+\.\d{2} paid today, then 11 monthly payments of £[\d,]+\.\d{2} · Visa ending 4242$/,
    ),
  ).toBeVisible();
  await expect(page.getByText(`A confirmation has been sent to ${email}.`)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);

  // 8. The policy is on the account page
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("region", { name: "Your policies" })).toContainText(reference);

  // 9. The saved quote now shows "Bought", with the policy
  await page.goto("/quote/retrieve");
  await expect(saved).toContainText("Bought");
  await expect(saved).toContainText(`Policy ${reference}`);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
});
