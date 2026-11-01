import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { demoNotice, mainNav } from "./links";
import { NotFound } from "./NotFound";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SiteLayout } from "./SiteLayout";

describe("SiteHeader", () => {
  it("links the wordmark home and names its links", async () => {
    await render(<SiteHeader />);
    await expect
      .element(page.getByRole("link", { name: "Kerb home" }))
      .toHaveAttribute("href", "/");
    await expect
      .element(page.getByRole("link", { name: "Log in" }))
      .toHaveAttribute("href", "/login");
    await expect
      .element(page.getByRole("link", { name: "Notifications" }))
      .toHaveAttribute("href", "/account/notifications");
  });

  it("has a named main nav with the four links at their paths", async () => {
    await page.viewport(1280, 800);
    await render(<SiteHeader />);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect.element(nav).toBeVisible();
    for (const { label, href } of mainNav) {
      await expect.element(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the current section with aria-current", async () => {
    await page.viewport(1280, 800);
    await render(<SiteHeader pathname="/claims/track" />);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect
      .element(nav.getByRole("link", { name: "Claims" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(nav.getByRole("link", { name: "Help" }))
      .not.toHaveAttribute("aria-current");
  });

  it("swaps the nav for a Menu button on mobile", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await expect.element(page.getByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Menu" })).toBeVisible();
  });
});

describe("Mobile menu", () => {
  it("opens with the nav links, closes on Escape and returns focus to Menu", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    const menu = page.getByRole("button", { name: "Menu" });
    await expect.element(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await expect.element(menu).toHaveAttribute("aria-expanded", "true");
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect.element(dialog).toBeVisible();
    for (const { label, href } of mainNav) {
      await expect.element(dialog.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(menu).toHaveAttribute("aria-expanded", "false");
    await expect.element(menu).toHaveFocus();
  });

  it("closes when a link is chosen", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    const link = dialog.getByRole("link", { name: "Help" });
    // Don't leave the test page: cancel the navigation, keep the click
    link.element().addEventListener("click", (e) => e.preventDefault());
    await link.click();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("closes with the Close button", async () => {
    await page.viewport(390, 800);
    await render(<SiteHeader />);
    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe("SiteFooter", () => {
  it("has four named link groups and the demo line", async () => {
    await render(<SiteFooter />);
    for (const name of ["Insurance", "Claims", "Support", "Account"]) {
      await expect.element(page.getByRole("navigation", { name })).toBeVisible();
    }
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Insurance" })
          .getByRole("link", { name: "Pet insurance" }),
      )
      .toHaveAttribute("href", "/insurance/pet");
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Insurance" })
          .getByRole("link", { name: "Business insurance" }),
      )
      .toHaveAttribute("href", "/insurance/business");
    await expect.element(page.getByRole("contentinfo").getByText(demoNotice)).toBeVisible();
  });
});

describe("SiteLayout", () => {
  it("renders the demo banner, skip link, header, main and footer", async () => {
    await render(
      <SiteLayout>
        <h1>Page</h1>
      </SiteLayout>,
    );
    await expect
      .element(page.getByRole("region", { name: "Demo notice" }))
      .toHaveTextContent(demoNotice);
    await expect.element(page.getByRole("banner")).toBeVisible();
    await expect.element(page.getByRole("main")).toHaveAttribute("id", "main");
    await expect
      .element(page.getByRole("main").getByRole("heading", { name: "Page" }))
      .toBeVisible();
    await expect.element(page.getByRole("contentinfo")).toBeVisible();
  });

  it("puts the skip link first in the Tab order", async () => {
    await render(
      <SiteLayout>
        <h1>Page</h1>
      </SiteLayout>,
    );
    await userEvent.tab();
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect.element(skip).toHaveFocus();
    await expect.element(skip).toHaveAttribute("href", "#main");
    await expect.element(skip).toBeVisible();
  });
});

describe("NotFound", () => {
  it("says the page isn't built yet, inside the site chrome, with a link home", async () => {
    await render(<NotFound />);
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("This page isn't built yet");
    await expect.element(page.getByRole("banner")).toBeVisible();
    await expect.element(page.getByRole("contentinfo")).toBeVisible();
    await expect
      .element(page.getByRole("main").getByRole("link", { name: /home/i }))
      .toHaveAttribute("href", "/");
  });
});
