import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousAxeViolations } from "./axe";
import { buyCarPolicy, buyHomePolicy } from "./buy-policy";
import { databaseUrl } from "./db";
import { payWithTestCard } from "./stripe";

// Changing a policy (6.3b; Change car and a home's own changes from 6.3c): a monthly customer adds a driver and sees the monthly price move;
// an annual customer moves up to Plus and pays the top-up in Stripe's embedded form. Like buy.spec
// it needs E2E_DATABASE_URL and a Stripe test publishable key (and the webhook reaching the
// deploy, for the top-up), and skips without them. axe on each dialog at 390, 768 and 1440 px.

const STRIPE_KEY = process.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

async function axeAtEachWidth(page: Page) {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoSeriousAxeViolations(page);
  }
}

test.beforeEach(() => {
  test.skip(!databaseUrl, "E2E_DATABASE_URL isn't set, so the run can't confirm the new account");
  test.skip(!STRIPE_KEY.startsWith("pk_test_"), "No Stripe test publishable key");
});

test("monthly: add a driver, see the price, confirm, and the policy shows them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = `delivered+e2e-change-${Date.now()}@resend.dev`;
  const reference = await buyCarPolicy(page, { email, plan: "monthly" });
  await page.goto(`/account/policies/${reference}`);
  await expect(page.getByRole("heading", { name: "Make a change" })).toBeVisible();
  // A click before the page is ready is lost
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("region", { name: "Make a change" })
    .getByRole("button", { name: /Add a driver/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add a driver" });
  await dialog.getByLabel("First name").fill("Arjun");
  await dialog.getByLabel("Last name").fill("Patel");
  const dob = dialog.getByRole("group", { name: "Date of birth" });
  await dob.getByLabel("Day").fill("2");
  await dob.getByLabel("Month").fill("11");
  await dob.getByLabel("Year").fill("1989");
  await dialog.getByLabel("Relationship to you").selectOption("partner");
  await dialog.getByLabel("Licence").selectOption("full_uk");
  const licence = dialog.getByRole("group", { name: "Full licence since" });
  await licence.getByLabel("Day").fill("1");
  await licence.getByLabel("Month").fill("6");
  await licence.getByLabel("Year").fill("2015");
  await dialog.getByLabel("Employment status").selectOption("retired");

  await expect(
    dialog.getByText(/^Your price (goes (up|down) by £\d+\.\d\d a month|stays the same)$/),
  ).toBeVisible();
  await axeAtEachWidth(page);
  await dialog.getByRole("button", { name: "Confirm change" }).click();
  await expect(page.getByText("Your policy's been updated")).toBeVisible();
  await expect(page.getByRole("region", { name: "Drivers" })).toContainText("Arjun Patel");
});

test("annual: move up to Plus and pay the top-up", async ({ page }) => {
  test.setTimeout(300_000);
  const email = `delivered+e2e-change-${Date.now()}@resend.dev`;
  const reference = await buyCarPolicy(page, { email, plan: "annual" });
  await page.goto(`/account/policies/${reference}`);
  await expect(page.getByRole("heading", { name: "Make a change" })).toBeVisible();
  // A click before the page is ready is lost
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("region", { name: "Make a change" })
    .getByRole("button", { name: /Change cover/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Change cover" });
  await dialog.getByRole("radio", { name: /Plus/ }).click();
  await expect(
    // The Plus card says it too; the price alert is the one that counts
    dialog.getByRole("status").getByText(/^You'll pay £[\d,]+\.\d\d now for the rest of the year$/),
  ).toBeVisible();
  await axeAtEachWidth(page);
  await dialog.getByRole("button", { name: "Confirm change" }).click();

  await payWithTestCard(page, { name: "Alex Morgan", email });
  await expect(page).toHaveURL(
    (url) => url.pathname === `/account/policies/${reference}` && url.searchParams.has("change"),
    {
      timeout: 60_000,
    },
  );
  // The webhook applies it: refresh until the cover says Plus
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("group", { name: "Cover" })).toContainText("Plus", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });
});

// 6.3c: Change car by demo plate, and a home's security update (a monitored alarm costs less)

test("monthly car: change car by demo plate, see the price, confirm; the page title shows the new car", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const email = `delivered+e2e-car-${Date.now()}@resend.dev`;
  const reference = await buyCarPolicy(page, { email, plan: "monthly" });
  await page.goto(`/account/policies/${reference}`);
  await expect(page.getByRole("heading", { name: "Make a change" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("region", { name: "Make a change" })
    .getByRole("button", { name: /Change car/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Change car" });
  await dialog.getByLabel("New car's registration").fill("TS24 EIV");
  await expect(dialog.getByText("We found it: Tesla Model 3, 2024")).toBeVisible();
  await axeAtEachWidth(page);
  await dialog.getByRole("button", { name: "Choose my car manually" }).click();
  await axeAtEachWidth(page);
  await dialog.getByRole("button", { name: "Look up by registration instead" }).click();
  await dialog.getByLabel("New car's registration").fill("AB12 CDE");
  await expect(dialog.getByText("We couldn't find that car")).toBeVisible();
  await axeAtEachWidth(page);
  await dialog.getByLabel("New car's registration").fill("TS24 EIV");
  await dialog.getByLabel("Current mileage").fill("9,000");
  await expect(
    dialog.getByText(/^Your price (goes (up|down) by £\d+\.\d\d a month|stays the same)$/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm change" }).click();
  await expect(page.getByText("Your policy's been updated")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tesla");
});

test("annual home: update security down, see the refund line, confirm; the toast shows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const email = `delivered+e2e-home-change-${Date.now()}@resend.dev`;
  const reference = await buyHomePolicy(page, { email });
  await page.goto(`/account/policies/${reference}`);
  await expect(page.getByRole("heading", { name: "Make a change" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const changes = page.getByRole("region", { name: "Make a change" });

  await changes.getByRole("button", { name: /Update contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Update contents" });
  await expect(contents).toBeVisible();
  await axeAtEachWidth(page);
  await contents.getByRole("button", { name: "Back" }).click();

  await changes.getByRole("button", { name: /Change cover/ }).click();
  const cover = page.getByRole("dialog", { name: "Change cover" });
  await expect(cover.getByLabel("Voluntary excess")).toHaveCount(0);
  await axeAtEachWidth(page);
  await cover.getByRole("button", { name: "Back" }).click();

  await changes.getByRole("button", { name: /Update security/ }).click();
  const dialog = page.getByRole("dialog", { name: "Update security" });
  await dialog
    .getByLabel("Burglar alarm")
    .selectOption({ label: "Professionally installed and monitored" });
  await expect(dialog.getByText(/^We'll refund £[\d,]+\.\d\d to your card$/)).toBeVisible();
  await axeAtEachWidth(page);
  await dialog.getByRole("button", { name: "Confirm change" }).click();
  await expect(page.getByText("Your policy's been updated")).toBeVisible();
});
