import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { confirmEmailInDatabase, databaseUrl } from "./db";
import { payWithTestCard } from "./stripe";

// Buying a home quote (5.7): the landing accordion's "Get a home insurance quote" → the postcode →
// About you → Property (the first demo address) → Contents and security → Past claims → Your quote
// → Choose cover → the gate, where a guest creates an account (the sign-up saves the home quote) →
// confirm the email → log in → Your saved quotes → Confirm and pay, in full → Stripe's form with
// the card that pays → You're covered → the policy on /account. At phone width, with axe on each
// home step at 390, 768 and 1440 px. Like buy.spec.ts it needs E2E_DATABASE_URL and a Stripe test
// publishable key, and skips without either.

const STRIPE_KEY = process.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

const PASSWORD = "kerb e2e password 2026";
const PHONE = { width: 390, height: 900 };
const WIDTHS = [390, 768, 1440];

async function expectNoSeriousAxeViolationsAtEachWidth(page: Page) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoSeriousAxeViolations(page);
  }
  await page.setViewportSize(PHONE);
}

async function fillDate(page: Page, legend: string, day: string, month: string, year: string) {
  const group = page.getByRole("group", { name: legend, exact: true });
  await group.getByRole("textbox", { name: "Day" }).fill(day);
  await group.getByRole("textbox", { name: "Month" }).fill(month);
  await group.getByRole("textbox", { name: "Year" }).fill(year);
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("a guest gets a home quote, creates an account, pays in full, and finds the policy on their account", async ({
  page,
}) => {
  test.skip(
    !databaseUrl,
    "E2E_DATABASE_URL isn't set, so the run can't confirm the new account's email",
  );
  test.skip(
    !STRIPE_KEY.startsWith("pk_test_"),
    "VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY isn't a test publishable key (pk_test_…), so Stripe's form can't be filled",
  );
  test.setTimeout(240_000);
  const email = `delivered+e2e-home-${Date.now()}@resend.dev`;
  await page.setViewportSize(PHONE);

  // 1. The landing accordion, then the postcode
  await page.goto("/");
  // The accordion's own summary: "Home insurance" is also in the header's menu
  await page.locator("summary", { hasText: "Home insurance" }).click();
  await page.getByRole("link", { name: "Get a home insurance quote" }).click();
  await expect(page).toHaveURL(/\/quote\?type=home/);
  // Typed before hydration, the box is reset when React takes over: wait for the page first
  await page.waitForLoadState("networkidle");
  const postcode = page.getByLabel("Your postcode");
  await postcode.fill("E8 3RL");
  await expect(postcode).toHaveValue("E8 3RL");
  await page.getByRole("button", { name: "Continue with home" }).click();

  // 2. About you
  await expect(heading(page, "Tell us about you")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
  await page.getByLabel("First name").fill("Priya");
  await page.getByLabel("Last name").fill("Shah");
  await fillDate(page, "Date of birth", "2", "3", "1988");
  await page.getByRole("button", { name: "Continue to property" }).click();

  // 3. Property: the first demo address for the postcode
  await expect(heading(page, "Tell us about your property")).toBeVisible();
  const addressList = page.getByLabel("Select your address");
  await expect(addressList.locator("option")).not.toHaveCount(1);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
  await addressList.selectOption({ index: 1 });
  await page.getByLabel("Property type").selectOption({ label: "Terraced house" });
  await page.getByLabel("Year built").fill("1985");
  await page.getByLabel("Bedrooms").selectOption("3");
  await page.getByLabel("Rebuild cost").fill("250,000");
  await page.getByRole("button", { name: "Continue to contents" }).click();

  // 4. Contents and security
  await expect(heading(page, "Your contents and home security")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
  await page.getByLabel("Total contents value").fill("50,000");
  await page.getByLabel("Valuables total").fill("5,000");
  await page
    .getByLabel("Main external door lock")
    .selectOption({ label: "Five-lever mortice deadlock" });
  await page.getByLabel("Window locks").selectOption({ label: "Locks on all accessible windows" });
  await page
    .getByLabel("Burglar alarm")
    .selectOption({ label: "Professionally installed, not monitored" });
  await page.getByText("Smoke alarms are fitted and working").click();
  await page.getByRole("button", { name: "Continue to past claims" }).click();

  // 5. Past claims: none
  await expect(heading(page, "Any home claims in the last 5 years?")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolationsAtEachWidth(page);
  await page.getByText("No", { exact: true }).click();
  await page.getByText("I confirm these details are complete and accurate.").click();
  await page.getByRole("button", { name: "Get my home quote" }).click();

  // 6. Your quote → Choose cover → Continue
  await expect(heading(page, "Your quote is ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Comprehensive price" })).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await expect(page).toHaveURL(/step=cover/);
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();

  // 7. The gate: create an account, which saves the home quote
  await expect(page).toHaveURL(/step=buy/);
  await expect(heading(page, "Sign in before you pay")).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/auth=signup/);
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByLabel("Full name").fill("Priya Shah");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  // 8. Confirm the email, log in, find the saved home quote
  await confirmEmailInDatabase(email);
  await page.goto("/login?redirect=/quote/retrieve");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  // The login page's own address ends in /quote/retrieve too: wait for the page itself, so a
  // reload can't cut the sign-in off
  await expect(page).toHaveURL(/^[^?]*\/quote\/retrieve$/);
  await expect(heading(page, "Your saved quotes")).toBeVisible();
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(saved).toContainText("Ready to buy");
  await saved.getByRole("link", { name: "Continue quote" }).click();

  // 9. Confirm and pay, in full, with Stripe's form
  await expect(heading(page, "Confirm and pay")).toBeVisible();
  await expect(page.getByText("Home insurance / Buy")).toBeVisible();
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  // Stripe's form (test mode), as a UK customer: e2e/stripe.ts
  await payWithTestCard(page, { name: "Priya Shah", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });

  // 10. You're covered, then the policy on the account
  await expect(heading(page, "You’re covered")).toBeVisible();
  await expect(page.getByText("Home insurance · Purchase complete")).toBeVisible();
  const policy = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  await expect(policy).toHaveCount(1);
  const reference = (await policy.getAttribute("aria-label"))!.replace("Policy ", "");
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("region", { name: "Your policies" })).toContainText(reference);
});
