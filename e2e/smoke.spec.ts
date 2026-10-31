import { expect, test, type Page } from "@playwright/test";

// Smoke test for the landing page on each deploy (3.4). Pages that aren't built yet reach the
// site 404, so links are checked by path, not by a 200 (plan/phases/03-landing/phase.md).

/** Collects console errors and CSP violations from the moment the page starts loading. */
async function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}

test("landing loads with a CDN cache header and no errors", async ({ page }) => {
  const problems = await watchForProblems(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const cacheControl = response?.headers()["cache-control"] ?? "";
  expect(cacheControl).toContain("s-maxage=");
  expect(cacheControl).toContain("stale-while-revalidate=");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kerb Online Insurance.");
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("hero form sends a tidy postcode to the quote start", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your postcode").fill("e83rl");
  await page.getByRole("button", { name: "Get a quote" }).click();
  await expect(page).toHaveURL(/\/quote\?postcode=E8\+3RL$/);
  // Phase 5 builds /quote; until then it's the site 404. Flip this when it lands.
  await expect(page.getByText("This page isn't built yet")).toBeVisible();
});

test("quote links point at the right paths", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero");
  await expect(hero.getByRole("link", { name: "Continue a saved quote" })).toHaveAttribute(
    "href",
    "/quote/retrieve",
  );
  await expect(page.getByRole("link", { name: "Get a car insurance quote" })).toHaveAttribute(
    "href",
    "/quote?type=car",
  );
});

for (const width of [320, 390, 768, 1440]) {
  test(`no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
