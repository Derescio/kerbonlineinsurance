import { expect, test, type Page } from "@playwright/test";

import { totpNow } from "../src/test/totp";
import { expectNoSeriousAxeViolations } from "./axe";
import { confirmEmailInDatabase, databaseUrl } from "./db";
import { withCompleteJourney } from "./quote-journey";

// 6.3: Account settings. A new account gets its customer record when its first quote is saved,
// so the run saves one through the mid-quote sign-up (as buy.spec.ts does), then adds a mobile,
// turns two-factor on and off, reads Recent activity, and signs out everywhere. Needs
// E2E_DATABASE_URL (e2e/db.ts) to confirm the sign-up, and skips without it.

const PASSWORD = "kerb e2e password 2026";
const WIDTHS = [390, 768, 1440];

async function axeAtEachWidth(page: Page) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoSeriousAxeViolations(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("a customer adds a mobile, turns two-factor on and off, and signs out everywhere", async ({
  page,
}) => {
  test.skip(
    !databaseUrl,
    "E2E_DATABASE_URL isn't set, so the run can't confirm the new account's email",
  );
  test.setTimeout(180_000);
  const email = `delivered+e2e-settings-${Date.now()}@resend.dev`;

  // 1. A saved car quote, through the sign-up at the gate
  await withCompleteJourney(page);
  await page.goto("/quote/car?postcode=E8+3RL&step=quote");
  await page.getByRole("button", { name: "Choose cover" }).click();
  await page
    .getByRole("button", { name: /^Continue with (Essential|Comprehensive|Plus)$/ })
    .click();
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
  await expect(page).toHaveURL(/\/quote\/retrieve$/);
  await expect(page.getByRole("heading", { level: 1, name: "My quotes" })).toBeVisible();
  // The sign-up saves the quote (and makes the customer) after its response
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("article", { name: /^Quote KRB-Q-\d{5}$/ })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  // 2. Personal details: add a mobile; it's still there after a reload
  await page.goto("/account/settings");
  await expect(page.getByRole("heading", { level: 2, name: "Personal details" })).toBeVisible();
  await axeAtEachWidth(page);
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByRole("textbox", { name: "Mobile number" }).fill("07700900418");
  await page.getByRole("button", { name: "Save changes" }).click();
  const mobile = page.getByRole("group", { name: "Mobile number", exact: true });
  await expect(mobile).toContainText("07700 900418");
  // Shown at once; Edit details comes back once the server has saved it
  await expect(page.getByRole("button", { name: "Edit details" })).toBeEnabled();
  await page.reload();
  await expect(mobile).toContainText("07700 900418");

  // 3. Security: turn two-factor on through 4.6's steps
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Security" })
    .click();
  await expect(page).toHaveURL(/\/account\/settings\/security$/);
  await axeAtEachWidth(page);
  await page.getByRole("link", { name: "Turn on" }).click();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.locator(".auth-setup-key__key").innerText()).replace(/\s+/g, "");
  await page.getByLabel("Then enter the 6-digit code it shows").fill(await totpNow(key));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await page.getByText("I've saved these somewhere safe").click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/account\/settings\/security$/);
  const twoFactor = page.getByRole("group", { name: "Two-factor", exact: true });
  await expect(twoFactor.getByText("On", { exact: true })).toBeVisible();

  // 4. Turn it off with the password
  await page.getByRole("button", { name: "Turn off" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off two-factor?" });
  await dialog.getByLabel("Password").fill(PASSWORD);
  // Off shows at once, but the disable replaces the session: a reload before its answer arrives
  // keeps the old, deleted token, so wait for the answer itself
  const disabled = page.waitForResponse((r) => r.url().endsWith("/api/auth/two-factor/disable"));
  await dialog.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(twoFactor.getByText("Off", { exact: true })).toBeVisible();
  expect((await disabled).ok()).toBe(true);

  // 5. Recent activity shows both
  await page.reload();
  const activity = page.getByRole("region", { name: "Recent activity" });
  await expect(activity.getByText("Two-factor turned on")).toBeVisible();
  await expect(activity.getByText("Two-factor turned off")).toBeVisible();

  // 6. An older Google link lands on Security with its toast
  await page.goto("/account/settings?linked=google");
  await expect(page).toHaveURL(/\/account\/settings\/security$/);
  await expect(page.getByText("Google connected")).toBeVisible();

  // 7. Sign out everywhere
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page
    .getByRole("dialog", { name: "Sign out everywhere?" })
    .getByRole("button", { name: "Sign out everywhere" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("You've been signed out on every device.")).toBeVisible();
  await page.goto("/account/settings");
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount%2Fsettings$/);
});
