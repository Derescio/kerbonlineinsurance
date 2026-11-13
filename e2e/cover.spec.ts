import { expect, test } from "@playwright/test";

import { withCompleteJourney } from "./quote-journey";

// Choose cover and the home offer (5.5): from Your quote to Plus with a £250 voluntary excess,
// breakdown cover and monthly payments, then on to "Add home insurance". Runs against a deployed
// preview, so the rating tables are the real ones.

const money = /£[\d,]+\.\d{2}/;

test("choosing Plus, a £250 excess, breakdown cover and monthly shows the breakdown and APR", async ({
  page,
}) => {
  await withCompleteJourney(page);
  await page.goto("/quote/car?postcode=E8+3RL&step=quote");
  await expect(page.getByRole("heading", { name: "Your Comprehensive price" })).toBeVisible();
  await page.getByRole("button", { name: "Choose cover" }).click();

  await expect(page).toHaveURL(/step=cover/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Compare your cover, side by side" }),
  ).toBeVisible();
  const plus = page.getByRole("radio", { name: "Plus", exact: true });
  await expect(page.getByRole("radio", { name: "Comprehensive", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Every level is priced again at the new excess
  const plusPrice = async () => (await plus.locator(".kb-cover__amount").textContent()) ?? "";
  const atNoExcess = await plusPrice();
  expect(atNoExcess).toMatch(money);
  await page.getByRole("combobox", { name: "Voluntary excess" }).selectOption({ label: "£250" });
  await expect.poll(plusPrice).not.toBe(atNoExcess);

  await plus.click();
  await page.getByText(/^Breakdown cover · /).click();
  await page.getByText("Pay monthly").click();

  const breakdown = page.getByRole("region", { name: "How your price is made up" });
  await expect(breakdown).toContainText("Plus cover");
  await expect(breakdown).toContainText("Breakdown cover£45.00");
  await expect(breakdown).toContainText("Cost of paying monthly (10%)");
  await expect(breakdown).toContainText("Representative APR23.6%");
  await expect(breakdown).toContainText("Total excess £400 (compulsory £150 + voluntary £250)");

  // The chosen card's monthly price is the breakdown's payment
  const payment = breakdown.locator("div", { hasText: "12 monthly payments of" }).locator("dd");
  const paymentText = (await payment.textContent())!;
  expect(paymentText).toMatch(money);
  await expect(plus).toHaveAccessibleDescription(new RegExp(paymentText.replace(/[.$]/g, "$&")));

  // A refresh keeps the choice
  await page.reload();
  await expect(plus).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Pay monthly/ })).toBeChecked();

  await page.getByRole("button", { name: "Continue with Plus" }).click();
  await expect(page).toHaveURL(/step=add-home/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Add home insurance to your car quote?" }),
  ).toBeVisible();
  await expect(page.getByText(`12 payments of ${paymentText}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Home postcode" })).toHaveValue("E8 3RL");
});
