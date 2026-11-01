import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// axe on each key page (plan/engineering.md section 4). Fails on serious or critical violations.
// Pages join the list as they ship.
const pages = ["/"];
const widths = [390, 1440];

for (const path of pages) {
  for (const width of widths) {
    test(`${path} at ${width}px has no serious or critical axe violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
        "serious/critical axe violations",
      ).toEqual([]);
    });
  }
}
