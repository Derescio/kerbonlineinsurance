import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

// 4.7: the privacy and cookies pages, and deleting a fresh sign-up. Previews use Cloudflare's
// always-pass Turnstile test keys and the `dev` database. The run can't open the confirmation
// email (Resend's test inbox), so the delete test confirms the address straight in the database:
// set E2E_DATABASE_URL (the deploy's Neon `dev` URL) to run it. Without it that test is skipped
// with the reason; the public-page tests need nothing.

const PASSWORD = "kerb e2e password 2026";
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

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

async function confirmEmailInDatabase(email: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query("update users set email_verified = true where email = $1", [
      email,
    ]);
    expect(result.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

for (const path of ["/privacy", "/cookies"]) {
  test(`${path} is cached publicly and carries no closure banner`, async ({ request, page }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    // publicCacheHeaders(): public, s-maxage=<PUBLIC_CACHE_SECONDS>, stale-while-revalidate
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).toMatch(/s-maxage=\d+/);
    expect(cacheControl).toContain("stale-while-revalidate");
    expect(cacheControl).not.toContain("no-store");

    // The banner is loaded client-side from a no-store function, never rendered into cached HTML
    const html = await response.text();
    expect(html).not.toContain("Keep my account");
    expect(html).not.toContain("Your account closes on");
    expect(html).not.toContain("Your account will close once");

    await page.goto(path);
    await expectNoSeriousAxeViolations(page);
  });
}

test("/privacy names the controller, its contact and PostHog", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("OpsEd Solutions").first()).toBeVisible();
  await expect(page.getByText("privacy@kerb.opsedsolutions.com").first()).toBeVisible();
  await expect(page.getByText("PostHog").first()).toBeVisible();
});

test("the account-deleted page passes axe", async ({ page }) => {
  await page.goto("/account-deleted");
  await expect(page.getByRole("heading", { name: "Your account has been deleted" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("a fresh sign-up deletes its account, is signed out, and can't log in again", async ({
  page,
}) => {
  test.skip(
    !databaseUrl,
    "E2E_DATABASE_URL isn't set, so the run can't confirm the new account's email",
  );
  const email = `delivered+e2e-close-${Date.now()}@resend.dev`;

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Closer");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByText("I agree to the terms of use").click();
  await expect(page.locator('[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  await confirmEmailInDatabase(email);

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.goto("/account/close");
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(page.getByRole("heading", { name: "Your account has been deleted" })).toBeVisible();

  // Really signed out: the cleared session cookies reached the browser
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount$/);

  // The account is gone
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page).not.toHaveURL(/\/account$/);
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
});
