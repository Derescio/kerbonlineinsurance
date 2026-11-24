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
  const saved = page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ });
  await expect(async () => {
    await page.reload();
    await expect(saved).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await saved.getByRole("link", { name: "Continue quote" }).click();

  if (plan === "monthly") await page.getByText("Pay monthly").click();
  await page.getByText("I confirm my details are correct").click();
  await page.getByText("I agree to the policy terms and understand my cover").click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page, { name: "Alex Morgan", email });
  await expect(page).toHaveURL(/\/quote\/covered\//, { timeout: 60_000 });
  const policy = page.getByRole("region", { name: /^Policy KRB-\d{6}$/ });
  return (await policy.getAttribute("aria-label"))!.replace("Policy ", "");
}
