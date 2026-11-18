import { expect, test } from "@playwright/test";

import { withCompleteJourney } from "./quote-journey";

// The quote start (5.1): every way in, with and without JavaScript. The quote.started call can
// fail where there's no database (a local preview); the journey must not notice.

const postcodeError = "Enter your full postcode, like E8 3RL.";

test("hero postcode → quote start → car journey, back and refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your postcode").fill("e83rl");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page).toHaveURL(/\/quote\?postcode=E8(\+|%20)3RL$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "What would you like to insure?",
  );
  const postcode = page.getByRole("textbox", { name: "Your postcode" });
  await expect(postcode).toHaveValue("E8 3RL");
  await expect(page.getByText("Added from your link. You can change it here.")).toBeVisible();

  await page.getByText("Car", { exact: true }).click();
  await page.getByRole("button", { name: "Continue with car" }).click();
  await expect(page).toHaveURL(/\/quote\/car\?postcode=E8(\+|%20)3RL$/);
  await expect(
    page.getByRole("navigation", { name: "Quote progress" }).getByText("Your details"),
  ).toBeVisible();

  // Back to the start: the choice and postcode come back from the URL, with no redirect loop
  await page.goBack();
  await expect(page).toHaveURL(/\/quote\?/);
  await expect(page.getByRole("radio", { name: "Car" })).toBeChecked();

  await page.goForward();
  await page.reload();
  await expect(page).toHaveURL(/\/quote\/car\?/);
  await expect(page.getByText("Postcode: E8 3RL")).toBeVisible();
});

test("a coming-soon type offers car, keeping the postcode", async ({ page }) => {
  await page.goto("/quote?type=landlord");
  await expect(page.getByRole("radio", { name: "Landlord" })).toBeChecked();
  await page.getByRole("textbox", { name: "Your postcode" }).fill("E8 3RL");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/quote\/coming-soon\?/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("More ways to cover your world");
  await page.getByRole("link", { name: "Get a car quote" }).click();
  await expect(page).toHaveURL(/\/quote\/car\?postcode=E8(\+|%20)3RL$/);
});

test("bad links are dropped quietly", async ({ page }) => {
  await page.goto("/quote/car");
  await expect(page).toHaveURL(/\/quote\?type=car$/);
  await expect(page.getByRole("radio", { name: "Car" })).toBeChecked();

  await page.goto("/quote?postcode=nope&type=van");
  await expect(page.getByRole("textbox", { name: "Your postcode" })).toHaveValue("");
  for (const radio of await page.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await expect(page.getByText(postcodeError)).toHaveCount(0);

  await page.goto("/quote/coming-soon?type=car&postcode=E8+3RL");
  await expect(page).toHaveURL(/\/quote\?type=car&postcode=E8(\+|%20)3RL$/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the start form reaches the car journey", async ({ page }) => {
    await page.goto("/quote");
    await page.getByText("Car", { exact: true }).click();
    await page.getByRole("textbox", { name: "Your postcode" }).fill("e8 3rl");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/quote\/car\?postcode=E8(\+|%20)3RL$/);
    await expect(page.getByText("Postcode: E8 3RL")).toBeVisible();
  });

  test("a bad postcode shows the error, next to what was typed", async ({ page }) => {
    await page.goto("/quote");
    await page.getByText("Car", { exact: true }).click();
    await page.getByRole("textbox", { name: "Your postcode" }).fill("E8");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/quote\?.*next=1/);
    await expect(page.getByText(postcodeError)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your postcode" })).toHaveValue("E8");
  });
});

// Nothing scrolls sideways at 360px on any car view (5.4b, call 12)
const carViews = [
  "/quote/car?postcode=E8+3RL",
  "/quote/car?postcode=E8+3RL&vehicle=manual",
  "/quote/car?postcode=E8+3RL&vehicle=not-found",
  ...["about", "driving", "claims", "drivers", "quote"].map(
    (step) => `/quote/car?postcode=E8+3RL&step=${step}`,
  ),
];

for (const path of carViews) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    // The car views open on an empty journey; the driver steps need the earlier answers
    if (path.includes("step=")) await withCompleteJourney(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
  });
}
