import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { withCompleteJourney } from "./quote-journey";

// axe on each key page (plan/engineering.md section 4). Fails on serious or critical violations.
// Pages join the list as they ship.
const pages = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/quote",
  "/quote?type=car&postcode=E8+3RL",
  "/quote/coming-soon?type=landlord&postcode=E8+3RL",
  "/quote/car?postcode=E8+3RL",
  "/quote/car?postcode=E8+3RL&vehicle=manual",
  "/quote/car?postcode=E8+3RL&vehicle=not-found",
];
const widths = [390, 1440];

// Signed-in pages redirect a signed-out visitor, so each is checked where it lands. The two-factor
// setup page signed in (frame 12, the staff gate) is checked in auth.spec.ts with the E2E staff
// account.
const redirected: [path: string, lands: RegExp][] = [
  ["/login/two-factor", /\/login$/],
  ["/account/two-factor", /\/login\?redirect=%2Faccount%2Ftwo-factor$/],
];

async function expectNoBlockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    "serious/critical axe violations",
  ).toEqual([]);
}

for (const path of pages) {
  for (const width of widths) {
    test(`${path} at ${width}px has no serious or critical axe violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoBlockingViolations(page);
    });
  }
}

// The driver steps (5.3) open only with the earlier answers in the tab, so each is checked with a
// complete journey already in sessionStorage
const quoteSteps = ["about", "driving", "claims", "drivers", "quote"];

for (const step of quoteSteps) {
  for (const width of widths) {
    test(`/quote/car?step=${step} at ${width}px has no serious or critical axe violations`, async ({
      page,
    }) => {
      await withCompleteJourney(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/quote/car?postcode=E8+3RL&step=${step}`);
      await expect(page).toHaveURL(new RegExp(`step=${step}`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoBlockingViolations(page);
    });
  }
}

for (const [path, lands] of redirected) {
  for (const width of widths) {
    test(`${path} signed out at ${width}px lands on log in with no serious or critical axe violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page).toHaveURL(lands);
      await page.waitForLoadState("networkidle");
      await expectNoBlockingViolations(page);
    });
  }
}
