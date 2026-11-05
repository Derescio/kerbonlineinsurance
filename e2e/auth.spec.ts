import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Accounts on a deploy (4.4, 4.4b): sign up → "Check your inbox" → logging in before confirming
// is refused, and the account page's guard. Previews use Cloudflare's always-pass Turnstile test
// keys and the `dev` database. Emails go to Resend's test inbox (delivered+…@resend.dev), so
// nothing reaches a real person, and the run can't open the link: confirm → log in is covered by
// the integration tests and the manual check on staging.

const PASSWORD = "kerb e2e password 2026";

async function expectNoSeriousAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
  ).toEqual([]);
}

test("sign up, then logging in before confirming asks you to confirm first", async ({ page }) => {
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

  // 03c: no session until the email is confirmed
  await expect(page.getByText("Check your inbox")).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
  await expectNoSeriousAxeViolations(page);

  // 02c
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Confirm your email first")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expectNoSeriousAxeViolations(page);

  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount$/);
});

test("an expired confirmation link offers a new one (07d)", async ({ page }) => {
  await page.goto("/email-confirmed?error=TOKEN_EXPIRED");
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a new link" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
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
