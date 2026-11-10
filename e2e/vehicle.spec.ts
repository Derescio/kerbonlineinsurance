import { expect, test, type Page } from "@playwright/test";

// The car step (5.2): a demo plate fills the car in, an unknown plate goes the manual way, and a
// postcode postcodes.io doesn't know goes back to the start. Runs against a deployed preview, so
// the postcode check and the catalogue are the real ones.

const select = (page: Page, name: string) => page.getByRole("combobox", { name });

test("a demo plate fills the car in, and a refresh keeps it", async ({ page }) => {
  await page.goto("/quote/car?postcode=E8+3RL");
  await page.getByRole("button", { name: "VW21 GQL" }).click();
  await expect(page.getByRole("textbox", { name: "Car registration" })).toHaveValue("VW21 GQL");
  await page.getByRole("button", { name: "Find my car" }).click();

  await expect(page).toHaveURL(/vehicle=manual/);
  await expect(select(page, "1 · Make")).toHaveValue("Volkswagen");
  await expect(select(page, "2 · Model")).toHaveValue("Golf");
  await expect(select(page, "3 · Year first registered")).toHaveValue("2021");
  await expect(select(page, "4 · Variant").locator("option:checked")).toHaveText(
    "1.0 TSI Life 5dr",
  );
  await page.getByRole("button", { name: "Confirm this car" }).click();
  await expect(page.getByText(/Your car: Volkswagen Golf 1\.0 TSI Life 5dr, 2021\./)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Your car: Volkswagen Golf 1\.0 TSI Life 5dr, 2021\./)).toBeVisible();
});

test("an unknown plate goes the manual way, and the views don't check the postcode again", async ({
  page,
}) => {
  await page.goto("/quote/car?postcode=E8+3RL");
  await expect(page.getByRole("heading", { name: "Let’s find your car" })).toBeVisible();
  // quote.started is sent once after hydration; count only what the views do after that
  await page.waitForLoadState("networkidle");

  // Every server function call from here on (the postcode check would be one of them)
  const serverCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) serverCalls.push(request.url());
  });

  await page.getByRole("textbox", { name: "Car registration" }).fill("AB12 CDE");
  await page.getByRole("button", { name: "Find my car" }).click();
  await expect(page).toHaveURL(/vehicle=not-found/);
  expect(page.url()).not.toMatch(/AB12/i);
  await expect(page.getByRole("heading", { name: "We don’t have that car" })).toBeVisible();

  await page.getByRole("button", { name: "Choose my car manually" }).click();
  await expect(page).toHaveURL(/vehicle=manual/);
  await select(page, "1 · Make").selectOption("Ford");
  await select(page, "2 · Model").selectOption("Fiesta");
  await select(page, "3 · Year first registered").selectOption("2019");
  await select(page, "4 · Variant").selectOption({ label: "1.0 EcoBoost 125 Titanium 5dr" });
  await expect(page.getByText("2019 · Petrol · 5 doors")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/vehicle=not-found/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Let’s find your car" })).toBeVisible();
  expect(serverCalls).toEqual([]);
});

test("a postcode that doesn't exist goes back to the start with an error", async ({ page }) => {
  await page.goto("/quote/car?postcode=ZZ1+1ZZ");
  await expect(page).toHaveURL(/\/quote\?.*error=postcode/);
  const postcode = page.getByRole("textbox", { name: "Your postcode" });
  await expect(postcode).toHaveValue("ZZ1 1ZZ");
  await expect(
    page.getByText("We couldn't find that postcode. Check it and try again."),
  ).toBeVisible();
});
