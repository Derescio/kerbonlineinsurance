import { expect, test } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { expectCdnCached } from "./cdn-cache";
import { confirmEmailInDatabase, databaseUrl } from "./db";

// 4.7: the privacy and cookies pages, and deleting a fresh sign-up. Previews use Cloudflare's
// always-pass Turnstile test keys and the `dev` database. The run can't open the confirmation
// email (Resend's test inbox), so the delete test confirms the address straight in the database
// (e2e/db.ts): set E2E_DATABASE_URL (the deploy's Neon `dev` URL) to run it. Without it that test
// is skipped with the reason; the public-page tests need nothing.

const PASSWORD = "kerb e2e password 2026";

for (const path of ["/privacy", "/cookies"]) {
  test(`${path} is cached publicly and carries no closure banner`, async ({ request, page }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    // publicCacheHeaders(): public, s-maxage=<PUBLIC_CACHE_SECONDS>, stale-while-revalidate
    await expectCdnCached(request, path, response);

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
  const main = page.getByRole("main");
  await expect(main).toContainText("OpsEd Solutions");
  await expect(main).toContainText("privacy@kerb.opsedsolutions.com");
  await expect(main).toContainText("PostHog");
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
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
});
