import { expect, type Page } from "@playwright/test";

import { confirmEmailInDatabase } from "./db";
import { withCompleteJourney } from "./quote-journey";
import { payWithTestCard } from "./stripe";

// A car policy bought the way buy.spec.ts buys one (5.6), without its page checks, for a spec that
// starts from a policy (6.3b's changes). Returns the policy reference; the page is on You're
// covered, signed in.

const PASSWORD = "kerb e2e password 2026";

export async function buyCarPolicy(
  page: Page,
  { email, plan }: { email: string; plan: "annual" | "monthly" },
): Promise<string> {
  await withCompleteJourney(page);
  await page.goto("/quote/car?postcode=E8+3RL&step=quote");
  await page.getByRole("button", { name: "Choose cover" }).click();
  await page.getByRole("button", { name: "Continue with Comprehensive" }).click();
  await page.getByRole("button", { name: "Continue with car only" }).click();

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
  await confirmEmailInDatabase(email);

  await page.goto("/login?redirect=/quote/retrieve");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  // Signed in first: a reload while the log-in is in flight cancels it
  await expect(page).toHaveURL(/\/quote\/retrieve$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "My quotes" })).toBeVisible();
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await saved.getByRole("link", { name: "Continue quote" }).click();

  // Clicks before the page is ready are lost, as buy.spec.ts waits too
  await expect(page.getByRole("heading", { level: 1, name: "Confirm and pay" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  if (plan === "monthly") {
    await page.getByText("Pay monthly").click();
    await expect(page.getByRole("radio", { name: /Pay monthly/ })).toBeChecked();
  }
  await page.getByText("I confirm my details are correct").click();
  await expect(
    page.getByRole("checkbox", { name: "I confirm my details are correct" }),
  ).toBeChecked();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await expect(
    page.getByRole("checkbox", { name: "I agree to the policy terms and understand my cover" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page, { name: "Alex Morgan", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });
  const policy = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  return (await policy.getAttribute("aria-label"))!.replace("Policy ", "");
}

/**
 * A home policy bought the way home-buy.spec.ts buys one (5.7), without its page checks, for 6.3c's
 * home changes: E8 3RL's first demo address, with no burglar alarm. Returns the policy
 * reference; the page is on You're covered, signed in.
 */
export async function buyHomePolicy(page: Page, { email }: { email: string }): Promise<string> {
  await page.goto("/quote?type=home");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Your postcode").fill("E8 3RL");
  await page.getByRole("button", { name: "Continue with home" }).click();

  await page.waitForLoadState("networkidle");
  await page.getByLabel("First name").fill("Priya");
  await page.getByLabel("Last name").fill("Shah");
  const dob = page.getByRole("group", { name: "Date of birth" });
  await dob.getByLabel("Day").fill("2");
  await dob.getByLabel("Month").fill("3");
  await dob.getByLabel("Year").fill("1988");
  await page.getByLabel("Employment status").selectOption({ label: "Employed" });
  await page.getByLabel("Occupation").selectOption({ label: "Teacher" });
  await page.getByRole("button", { name: "Continue to property" }).click();

  const addressList = page.getByLabel("Select your address");
  await expect(addressList.locator("option")).not.toHaveCount(1);
  await page.waitForLoadState("networkidle");
  await addressList.selectOption({ index: 1 });
  await page.getByLabel("Property type").selectOption({ label: "Terraced house" });
  await page.getByLabel("Year built").fill("1985");
  await page.getByLabel("Bedrooms").selectOption("3");
  await page.getByLabel("Rebuild cost").fill("250,000");
  await page.getByRole("button", { name: "Continue to contents" }).click();

  await page.waitForLoadState("networkidle");
  await page.getByLabel("Total contents value").fill("50,000");
  await page.getByLabel("Valuables total").fill("5,000");
  await page
    .getByLabel("Main external door lock")
    .selectOption({ label: "Five-lever mortice deadlock" });
  await page.getByLabel("Window locks").selectOption({ label: "Locks on all accessible windows" });
  // No alarm, so 6.3c's spec can fit one and see the price go down (only having one is rated)
  await page.getByLabel("Burglar alarm").selectOption({ label: "No alarm" });
  await page.getByText("Smoke alarms are fitted and working").click();
  await page.getByRole("button", { name: "Continue to past claims" }).click();

  await page.waitForLoadState("networkidle");
  await page.getByText("No", { exact: true }).click();
  await page.getByText("I confirm these details are complete and accurate.").click();
  await page.getByRole("button", { name: "Get my home quote" }).click();
  await page.getByRole("button", { name: "Choose cover" }).click();
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByLabel("Full name").fill("Priya Shah");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  await confirmEmailInDatabase(email);

  await page.goto("/login?redirect=/quote/retrieve");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/^[^?]*\/quote\/retrieve$/, { timeout: 30_000 });
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await saved.getByRole("link", { name: "Continue quote" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Confirm and pay" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page, { name: "Priya Shah", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });
  const policy = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  return (await policy.getAttribute("aria-label"))!.replace("Policy ", "");
}
