import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { confirmEmailInDatabase, databaseUrl } from "./db";
import { withCompleteJourney } from "./quote-journey";
import { payWithTestCard } from "./stripe";

// Adding another product later (6.1b): a guest buys car (a complete journey → the gate → sign up →
// confirm → log in → My quotes → pay in full) → the Overview offers "Add home insurance" with the
// saving → About you filled in from the customer record, employment still asked → Property with
// the typed-in address → Choose cover shows the saving and not the bundle offer → the signed-in
// gate saves and goes to pay, which says why the price is lower → You're covered → both policies
// on the Overview under the car + home banner. At phone width. Like buy.spec.ts it needs
// E2E_DATABASE_URL and a Stripe test publishable key, and skips without either.

const STRIPE_KEY = process.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

const PASSWORD = "kerb e2e password 2026";
const PHONE = { width: 390, height: 900 };
const SAVING = "You save 8% because you already insure your car with us.";

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

/** Confirm and pay, in full, then Stripe's form; ends on You're covered */
async function payInFull(page: Page, email: string) {
  await expect(heading(page, "Confirm and pay")).toBeVisible();
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page, { name: "Alex Morgan", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });
  await expect(heading(page, "You’re covered")).toBeVisible();
}

test("a car customer adds home from their account, with 8% off, and sees car + home together", async ({
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
  test.setTimeout(300_000);
  const email = `delivered+e2e-add-${Date.now()}@resend.dev`;
  await page.setViewportSize(PHONE);
  await withCompleteJourney(page);

  // 1. Buy car: Your quote → Choose cover → car only → the gate → create an account
  await page.goto("/quote/car?postcode=E8+3RL&step=quote");
  await expect(page.getByRole("heading", { name: "Your Comprehensive price" })).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
  await expect(page).toHaveURL(/step=add-home/);
  await page.getByRole("button", { name: "Continue with car only" }).click();
  await expect(page).toHaveURL(/step=buy/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByLabel("Full name").fill("Alex Morgan");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  // 2. Confirm, log in, and pay for the car from My quotes
  await confirmEmailInDatabase(email);
  await page.goto("/login?redirect=/quote/retrieve");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/^[^?]*\/quote\/retrieve$/);
  await expect(heading(page, "My quotes")).toBeVisible();
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await saved.getByRole("link", { name: "Continue quote" }).click();
  await payInFull(page, email);

  // 3. The Overview offers home, with the saving
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(SAVING)).toBeVisible();
  await expect(page.getByText("Car + home. Better together.")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Add home insurance" }).click();

  // 4. About you, filled in from the customer record; employment is still asked
  await expect(page).toHaveURL(/\/quote\/home/);
  await expect(heading(page, "Tell us about you")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("First name")).toHaveValue("Alex");
  await expect(page.getByLabel("Last name")).toHaveValue("Morgan");
  await expect(page.getByLabel("Employment status")).toHaveValue("");
  await page.getByLabel("Employment status").selectOption({ label: "Employed" });
  await page.getByLabel("Occupation").selectOption({ label: "Teacher" });
  await page.getByRole("button", { name: "Continue to property" }).click();

  // 5. Property, with the record's address typed in
  await expect(heading(page, "Tell us about your property")).toBeVisible();
  await expect(page.getByLabel("Address line 1")).toHaveValue("18 Albion Road");
  await page.getByLabel("Property type").selectOption({ label: "Terraced house" });
  await page.getByLabel("Year built").fill("1985");
  await page.getByLabel("Bedrooms").selectOption("3");
  await page.getByLabel("Rebuild cost").fill("250,000");
  await page.getByRole("button", { name: "Continue to contents" }).click();

  // 6. Contents and security, then no past claims
  await expect(heading(page, "Your contents and home security")).toBeVisible();
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
  await expect(heading(page, "Any home claims in the last 5 years?")).toBeVisible();
  await page.getByText("No", { exact: true }).click();
  await page.getByText("I confirm these details are complete and accurate.").click();
  await page.getByRole("button", { name: "Get my home quote" }).click();

  // 7. Choose cover: the saving and why, with no bundle offer; signed in, the gate goes to pay
  await expect(heading(page, "Your quote is ready")).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await expect(page).toHaveURL(/step=cover/);
  await expect(page.getByText(SAVING)).toBeVisible();
  await expect(page.getByText(/save 8% on both/i)).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
  await expect(page).toHaveURL(/\/quote\/pay\//, { timeout: 30_000 });

  // 8. Pay names the saving and why, then the home is bought
  await expect(page.getByText("Your saving")).toBeVisible();
  await expect(page.getByText(SAVING)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
  await payInFull(page, email);

  // 9. Both policies on the Overview, under the car + home banner with the saving
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  const policies = page.getByRole("region", { name: "Your policies" });
  const banner = policies.getByRole("group", { name: "Car + home. Better together." });
  await expect(banner).toBeVisible();
  await expect(
    banner.getByText("Your home insurance costs less because you already insure your car with us."),
  ).toBeVisible();
  await expect(banner.getByText("saved every year")).toBeVisible();
  await expect(policies).toContainText("Volkswagen Golf");
  await expect(policies).toContainText("18 Albion Road");
  await expect(page.getByText(/after your £[\d,]+(\.\d{2})? saving/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add (car|home) insurance/ })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
});
