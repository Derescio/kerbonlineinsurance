import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Accounts on a deploy (4.4): sign up → log out → log in, and the account page's guard. Previews
// use Cloudflare's always-pass Turnstile test keys and the `dev` database. Emails go to Resend's
// test inbox (delivered+…@resend.dev), so nothing reaches a real person.

const PASSWORD = "kerb e2e password 2026";

test("sign up, log out and log back in", async ({ page }) => {
  const email = `delivered+e2e-${Date.now()}@resend.dev`;

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  // The test site key passes on its own; wait for its token before submitting
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E");
  await expect(page.getByText("Confirm your email")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
  ).toEqual([]);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("the account page sends a signed-out visitor to log in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount$/);
  await expect(page.getByRole("heading", { name: "Log in to Kerb" })).toBeVisible();
});

test("auth pages are never cached", async ({ request }) => {
  for (const path of ["/login", "/signup"]) {
    const response = await request.get(path);
    expect(response.headers()["cache-control"], path).toContain("no-store");
  }
});
