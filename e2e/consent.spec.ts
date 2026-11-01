import { expect, test, type Page } from "@playwright/test";

// Cookie consent (3.6): PostHog stores nothing until the visitor accepts. PostHog's requests (all
// through the /ingest proxy) are answered here, so test runs send no events. A deploy without the
// PostHog variables has no bar, and these tests skip.

/** PostHog's identity cookie and localStorage key are `ph_<token>_posthog`. */
async function posthogStorage(page: Page) {
  const cookies = (await page.context().cookies()).map((c) => c.name);
  const local = await page.evaluate(() => Object.keys(localStorage));
  return [...cookies, ...local].filter((name) => name.startsWith("ph_"));
}

async function openFresh(page: Page) {
  await page.route(/\/ingest\//, (route) => route.fulfill({ status: 200, body: "{}" }));
  await page.goto("/");
  const bar = page.getByRole("region", { name: "Cookie choices" });
  const shown = await bar
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!shown, "PostHog isn't configured on this deploy");
  return bar;
}

test("a fresh visit stores nothing for PostHog before a choice", async ({ page }) => {
  await openFresh(page);
  await page.waitForLoadState("networkidle");
  expect(await posthogStorage(page)).toEqual([]);
});

test("Accept turns on PostHog's cookie, and the bar stays away on the next visit", async ({
  page,
}) => {
  const bar = await openFresh(page);
  await bar.getByRole("button", { name: "Accept cookies" }).click();
  await expect(bar).toBeHidden();
  await expect.poll(() => posthogStorage(page)).not.toEqual([]);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(bar).toBeHidden();
});

test("Reject keeps PostHog cookieless, and Cookie settings asks again", async ({ page }) => {
  const bar = await openFresh(page);
  await bar.getByRole("button", { name: "Reject cookies" }).click();
  await expect(bar).toBeHidden();
  await page.waitForLoadState("networkidle");
  expect(await posthogStorage(page)).toEqual([]);

  await page.getByRole("button", { name: "Cookie settings" }).click();
  await expect(bar).toBeVisible();
});
