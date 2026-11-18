import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { demoNotice } from "#/components/site/links";
import { renderWithRouter } from "#/test/router";

import { QuoteFrame } from "./QuoteFrame";

// The frame mounts the closure banner, whose server function the component project can't load
vi.mock("#/features/account/closure", () => ({
  getClosureBanner: vi.fn().mockResolvedValue(null),
  keepMyAccount: vi.fn(),
}));

const inbox = "mailto:hello@kerb.opsedsolutions.com";

function frame(pathname: string, search: { step?: string } = {}) {
  return renderWithRouter(
    <QuoteFrame pathname={pathname} search={search}>
      <h1>A step</h1>
    </QuoteFrame>,
    pathname,
  );
}

describe("QuoteFrame (5.4b, decision 4)", () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it("has the demo bar, skip link, header, main and the slim footer", async () => {
    await frame("/quote/car");
    await expect
      .element(page.getByRole("region", { name: "Demo notice" }))
      .toHaveTextContent(demoNotice);
    await expect
      .element(page.getByRole("link", { name: "Skip to content" }))
      .toHaveAttribute("href", "#main");
    await expect.element(page.getByRole("main")).toHaveAttribute("id", "main");
    await expect.element(page.getByRole("main")).toHaveTextContent("A step");

    const footer = page.getByRole("contentinfo");
    await expect
      .element(
        footer.getByText(
          "Kerb is a fictional insurer made for a portfolio project. No real cover is sold.",
        ),
      )
      .toBeVisible();
    await expect
      .element(footer.getByRole("link", { name: "Privacy" }))
      .toHaveAttribute("href", "/privacy");
    await expect
      .element(footer.getByRole("link", { name: "Cookies" }))
      .toHaveAttribute("href", "/cookies");
    await expect.element(footer.getByRole("link", { name: "Help" })).toHaveAttribute("href", inbox);
    await expect.element(page.getByRole("link", { name: "Accessibility" })).not.toBeInTheDocument();
  });

  it("links the wordmark home and Need help? to the inbox", async () => {
    await frame("/quote/car");
    const header = page.getByRole("banner");
    await expect
      .element(header.getByRole("link", { name: "Kerb home" }))
      .toHaveAttribute("href", "/");
    await expect
      .element(header.getByRole("link", { name: "Need help?" }))
      .toHaveAttribute("href", inbox);
  });

  it("shows the Stepper on a car step, current from the URL", async () => {
    await page.viewport(1280, 900);
    await frame("/quote/car", { step: "quote" });
    const progress = page.getByRole("navigation", { name: "Quote progress" });
    await expect
      .element(progress.getByRole("listitem").filter({ hasText: "Your quote" }))
      .toHaveAttribute("aria-current", "step");
  });

  it("shows no Stepper on the start page", async () => {
    await page.viewport(1280, 900);
    await frame("/quote");
    await expect.element(page.getByRole("banner")).toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Quote progress" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("progressbar", { name: "Quote progress" }))
      .not.toBeInTheDocument();
  });

  it("shows the bar and 'Step 1 of 4: Your details' on a phone", async () => {
    await page.viewport(360, 800);
    await frame("/quote/car");
    await expect
      .element(page.getByRole("progressbar", { name: "Quote progress" }))
      .toHaveAttribute("aria-valuetext", "Step 1 of 4: Your details");
    await expect.element(page.getByText("Step 1 of 4: Your details")).toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Quote progress" }))
      .not.toBeInTheDocument();
  });
});
