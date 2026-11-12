import { expect, test, type Locator, type Page } from "@playwright/test";

// The driver steps (5.3) and the price (5.4): from a confirmed demo car through About you, licence
// and driving, claims and a 19-year-old named driver to the price. Runs against a deployed preview,
// so the occupations, the catalogue and the rating tables are the real ones.

const select = (page: Page, name: string) => page.getByRole("combobox", { name, exact: true });
const box = (scope: Page | Locator, name: string) =>
  scope.getByRole("textbox", { name, exact: true });

async function fillDate(page: Page, legend: string, [day, month, year]: number[]) {
  const group = page.getByRole("group", { name: legend, exact: true });
  await box(group, "Day").fill(String(day));
  await box(group, "Month").fill(String(month));
  await box(group, "Year").fill(String(year));
}

/** From a demo plate to "Get my car quote", with a 19-year-old named driver */
async function quoteWithYoungDriver(page: Page, plate: string, variant: string) {
  const year = new Date().getFullYear();

  await page.goto("/quote/car?postcode=E8+3RL");
  await page.getByRole("button", { name: plate }).click();
  await page.getByRole("button", { name: "Find my car" }).click();
  await expect(select(page, "Variant").locator("option:checked")).toHaveText(variant);
  await page.getByRole("button", { name: "Confirm this car" }).click();
  await page.getByRole("button", { name: "Continue to your details" }).click();

  // About you
  await expect(page).toHaveURL(/step=about/);
  await box(page, "First name").fill("Alex");
  await box(page, "Last name").fill("Morgan");
  await fillDate(page, "Date of birth", [12, 5, 1991]);
  await select(page, "Employment status").selectOption({ label: "Employed" });
  await select(page, "Occupation").selectOption({ label: "Accountant" });
  await box(page, "Address line 1").fill("18 Albion Road");
  await box(page, "Town or city").fill("London");
  await page.getByRole("button", { name: "Continue to your licence" }).click();

  // Licence and driving
  await expect(page).toHaveURL(/step=driving/);
  await select(page, "Licence type").selectOption({ label: "Full UK" });
  await fillDate(page, "Date full licence obtained", [18, 7, 2010]);
  await select(page, "Years of no-claims discount").selectOption({ label: "5 years" });
  await box(page, "Annual mileage").fill("8,000");
  await box(page, "Current mileage").fill("18200");
  await select(page, "Use of the car").selectOption({ label: "Social, domestic and commuting" });
  await select(page, "Where is the car kept overnight?").selectOption({ label: "Driveway" });
  await page.getByRole("button", { name: "Continue to claims" }).click();

  // Claims: one incident last year
  await expect(page).toHaveURL(/step=claims/);
  await page.getByText("Yes", { exact: true }).click();
  await fillDate(page, "Date of incident", [1, 3, year - 1]);
  await select(page, "Type of incident").selectOption({ label: "Collision" });
  await select(page, "Responsibility").selectOption({ label: "Not at fault" });
  await box(page, "Total claim cost").fill("1200");
  await page.getByText("I confirm my driving history is complete and accurate.").click();
  await page.getByRole("button", { name: "Continue to named drivers" }).click();

  // Named drivers: a 19-year-old with a licence from last year
  await expect(page).toHaveURL(/step=drivers/);
  await page
    .getByRole("group", { name: "Would you like to add a named driver?" })
    .getByText("Yes", { exact: true })
    .click();
  await box(page, "First name").fill("Sam");
  await box(page, "Last name").fill("Morgan");
  await fillDate(page, "Date of birth", [1, 1, year - 19]);
  await select(page, "Relationship to you").selectOption({ label: "Son or daughter" });
  await select(page, "Employment status").selectOption({ label: "Student" });
  await select(page, "Licence type").selectOption({ label: "Full UK" });
  await fillDate(page, "Date full licence obtained", [1, 1, year - 1]);
  await page
    .getByRole("group", { name: "Any accidents, claims or losses in the last 5 years?" })
    .getByText("No", { exact: true })
    .click();
  await page.getByRole("button", { name: "Get my car quote" }).click();
  await expect(page).toHaveURL(/step=quote/);
}

// The pay cards' totals (5.4b, call 10): two when the quote is priced, none otherwise
const totals = /^Total payable £[\d,]+\.\d{2}$/;

test("a car quote's driver steps end on the Golf's price, and a refresh keeps it", async ({
  page,
}) => {
  await quoteWithYoungDriver(page, "VW21 GQL", "1.0 TSI Life 5dr");

  // Group 14: the 19-year-old raises the price but doesn't stop it (5.4)
  await expect(page.getByRole("heading", { name: "Your Comprehensive price" })).toBeVisible();
  await expect(page.getByText(totals)).toHaveCount(2);
  await expect(page.getByText("Sam Morgan")).toBeVisible();
  await expect(page.getByText("1 incident")).toBeVisible();
  for (const typed of ["Alex", "Sam", "Albion", "Morgan"]) expect(page.url()).not.toContain(typed);

  await page.reload();
  await expect(page.getByText(totals)).toHaveCount(2);
  await expect(page.getByText("Sam Morgan")).toBeVisible();
});

test("the Tesla is declined with a 19-year-old named driver; removing him prices it, and Undo puts him back", async ({
  page,
}) => {
  await quoteWithYoungDriver(page, "TS24 EIV", "RWD");

  // Group 32: under 21 on group 30 or above is declined, and the person applying is told who
  await expect(
    page.getByText(
      "Unfortunately, we’re unable to provide cover with Sam included as a named driver.",
    ),
  ).toBeVisible();
  await expect(page.getByText(totals)).toHaveCount(0);
  // Removed on the spot and priced again, with Undo to put him back
  await page.getByRole("button", { name: "Remove Sam to see a price without them" }).click();
  await expect(page.getByText("Sam has been removed from this quote.")).toBeVisible();
  await expect(page.getByText(totals)).toHaveCount(2);
  await expect(page).toHaveURL(/step=quote/);
  await page.getByRole("button", { name: "Add Sam back" }).click();
  await expect(
    page.getByText(
      "Unfortunately, we’re unable to provide cover with Sam included as a named driver.",
    ),
  ).toBeVisible();
});

test("a cold link to a later step goes back to the car step", async ({ page }) => {
  await page.goto("/quote/car?postcode=E8+3RL&step=drivers");
  await expect(page.getByRole("heading", { name: "Let’s find your car" })).toBeVisible();
  expect(page.url()).not.toMatch(/step=/);
});
