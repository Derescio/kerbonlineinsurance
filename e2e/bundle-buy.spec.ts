import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { confirmEmailInDatabase, databaseUrl } from "./db";
import { completeCarJourney, withCompleteJourney } from "./quote-journey";
import { payWithTestCard } from "./stripe";

// Buying car and home together (5.7b). Car first: the car journey (seeded, as buy.spec.ts does) →
// Choose cover → "Add home insurance" → the home steps from Property (About you and the address come
// from the car) → home's Choose cover with the bundle panel → the gate, where a guest creates an account (the
// sign-up saves the bundle) → confirm the email → log in → Your saved quotes → Confirm and pay → one
// Stripe payment → You're covered with both policies → both on /account. Home first: home's Choose
// cover → "Add car insurance" → the car journey keeps the home → screen 21's "See both together"
// lands on home's Choose cover with the panel. At phone width. Like buy.spec.ts it needs E2E_DATABASE_URL
// and a Stripe test publishable key, and skips without either.

const STRIPE_KEY = process.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

const PASSWORD = "kerb e2e password 2026";
const PHONE = { width: 390, height: 900 };

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

/** The home steps after About you, with the answers home-buy.spec.ts gives */
async function answerHome(page: Page) {
  await expect(heading(page, "Tell us about your property")).toBeVisible();
  // A typed-in address carried from the car is kept; otherwise the first demo address
  if (await page.getByLabel("Select your address").isVisible()) {
    const addressList = page.getByLabel("Select your address");
    await expect(addressList.locator("option")).not.toHaveCount(1);
    await addressList.selectOption({ index: 1 });
  }
  await page.getByLabel("Property type").selectOption({ label: "Terraced house" });
  await page.getByLabel("Year built").fill("1985");
  await page.getByLabel("Bedrooms").selectOption("3");
  await page.getByLabel("Rebuild cost").fill("250,000");
  await page.getByRole("button", { name: "Continue to contents" }).click();

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
}

test("a guest adds home to a car quote, pays once for both, and finds both policies on their account", async ({
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
  const email = `delivered+e2e-bundle-${Date.now()}@resend.dev`;
  await page.setViewportSize(PHONE);

  // 1. The car's Choose cover, then screen 21
  await withCompleteJourney(page);
  await page.goto("/quote/car?postcode=E8+3RL&step=cover");
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
  await expect(heading(page, "Add home insurance to your car quote?")).toBeVisible();
  await page.getByRole("button", { name: "Add home insurance" }).click();

  // 2. Home's About you is the car's main driver, so the home steps open at Property, with the
  //    car's address typed in (Damion's preview check, 17 Nov 2026)
  await expect(page).toHaveURL(/\/quote\/home\?.*step=property/);
  await expect(page.getByLabel("Address line 1")).toHaveValue("18 Albion Road");
  await answerHome(page);

  // 3. Your quote → home's Choose cover with the car beside it
  await expect(heading(page, "Your quote is ready")).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  const panel = page.getByRole("region", { name: "Your car quote" });
  await expect(panel).toContainText("Bundle saving");
  await expect(panel).toContainText(/Together: £[\d,]+\.\d{2} a year/);
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Continue to sign in" }).click();

  // 4. The gate: create an account, which saves the bundle
  await expect(page).toHaveURL(/step=buy/);
  await expect(heading(page, "Sign in before you pay")).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/auth=signup/);
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByLabel("Full name").fill("Alex Morgan");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  // 5. Confirm the email, log in, find the saved bundle
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
  await expect(saved).toContainText("Car + home");
  await saved.getByRole("link", { name: "Continue quote" }).click();

  // 6. Confirm and pay once for both, with Stripe's form
  await expect(heading(page, "Confirm and pay")).toBeVisible();
  await expect(page.getByText("Car + home insurance / Buy")).toBeVisible();
  await expect(page.getByText("Bundle saving")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectNoSeriousAxeViolations(page);
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page, { name: "Alex Morgan", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });

  // 7. You're covered with both policies, then both on the account
  await expect(heading(page, "You’re covered")).toBeVisible();
  await expect(page.getByText("Car + home insurance · Purchase complete")).toBeVisible();
  const policies = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  await expect(policies).toHaveCount(2);
  await page.getByRole("link", { name: "Go to my account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  // The Overview (6.1): both under the bundle, the car by name
  const yours = page.getByRole("region", { name: "Your policies" });
  await expect(yours.getByRole("group", { name: "Car + home bundle" })).toBeVisible();
  await expect(yours).toContainText("Volkswagen Golf");
  await expect(yours.getByText("Active")).toHaveCount(2);
});

test("a home quote adds car, and the car journey comes back to the bundle", async ({ page }) => {
  await page.setViewportSize(PHONE);

  // 1. A home quote answered in full, then home's Choose cover offers car
  await page.goto("/quote/home?postcode=E8+3RL");
  await expect(heading(page, "Tell us about you")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First name").fill("Alex");
  await page.getByLabel("Last name").fill("Morgan");
  const dob = page.getByRole("group", { name: "Date of birth", exact: true });
  await dob.getByRole("textbox", { name: "Day" }).fill("12");
  await dob.getByRole("textbox", { name: "Month" }).fill("5");
  await dob.getByRole("textbox", { name: "Year" }).fill("1991");
  await page.getByLabel("Employment status").selectOption({ label: "Employed" });
  await page.getByLabel("Occupation").selectOption({ label: "Plumber" });
  await page.getByRole("button", { name: "Continue to property" }).click();
  await answerHome(page);
  await expect(heading(page, "Your quote is ready")).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await expect(page.getByText(/Insure your car with us too and save \d+% on both\./)).toBeVisible();
  await page.getByRole("button", { name: "Add car insurance" }).click();

  // 2. The car journey, keeping the home: its answers stand in for the car steps (their own specs
  //    type them), under the id the home's mark names
  await expect(page).toHaveURL(/\/quote\/car\?/);
  const car = await completeCarJourney(page);
  await page.evaluate((answers) => {
    const started = JSON.parse(sessionStorage.getItem("kerb.quote.v1.car")!) as {
      journeyId: string;
    };
    sessionStorage.setItem(
      "kerb.quote.v1.car",
      JSON.stringify({ ...answers, journeyId: started.journeyId }),
    );
  }, car);
  await page.goto("/quote/car?postcode=E8+3RL&step=cover");
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
  // Screen 21 knows the home quote is waiting
  await expect(page.getByText("Your home quote is ready")).toBeVisible();
  await page.getByRole("button", { name: "See both together" }).click();

  // 3. Straight to home's Choose cover, with the panel
  await expect(page).toHaveURL(/\/quote\/home\?.*step=cover/);
  const panel = page.getByRole("region", { name: "Your car quote" });
  await expect(panel).toContainText(/Together: £[\d,]+\.\d{2} a year/);
});
