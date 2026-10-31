import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { productIds } from "#/features/quote/products";

import { ClosingCta } from "./ClosingCta";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { InsuranceTypes } from "./InsuranceTypes";
import { LandingPage } from "./LandingPage";
import { QuickActions } from "./QuickActions";
import { TrustStrip } from "./TrustStrip";

describe("TrustStrip", () => {
  it("has three stats, with the rating slot waiting for real reviews", async () => {
    const { container } = await render(<TrustStrip />);
    const stats = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toContain("Reviews coming soon");
  });

  it("shows no review score, review count, stars or regulator number", async () => {
    const { container } = await render(<TrustStrip />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d(\.\d)?\s*\/\s*5/); // 4.8 / 5
    expect(text).not.toMatch(/[\d,]+\s+(customer\s+)?reviews/i); // From 12,400 customer reviews
    expect(text).not.toMatch(/★|\bFCA\b|firm reference|FRN/i);
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("InsuranceTypes", () => {
  it("lists the six types in Figma order, with car open", async () => {
    const { container } = await render(<InsuranceTypes />);
    const labels = [...container.querySelectorAll("summary")].map((s) => s.textContent);
    expect(labels).toEqual([
      "Car insurance",
      "Home insurance",
      "Condo insurance",
      "Tenant insurance",
      "Landlord insurance",
      "Pet insurance",
      "Business insurance",
    ]);
    const open = [...container.querySelectorAll("details[open] summary")].map((s) => s.textContent);
    expect(open).toEqual(["Car insurance"]);
    await expect
      .element(page.getByRole("link", { name: "Get a car insurance quote" }))
      .toHaveAttribute("href", "/quote?type=car");
  });

  it("opens another type on click, with a quote link for that type", async () => {
    await render(<InsuranceTypes />);
    const home = page.getByText("Home insurance");
    await home.click();
    const details = home.element().closest("details")!;
    expect(details.open).toBe(true);
    await expect
      .element(page.getByRole("link", { name: "Get a home insurance quote" }))
      .toHaveAttribute("href", "/quote?type=home");
  });

  it("gives every type one quote link with its own type", async () => {
    const { container } = await render(<InsuranceTypes />);
    const hrefs = [...container.querySelectorAll("details a")].map((a) => a.getAttribute("href"));
    // Columns read car, home, condo, then tenant, landlord, pet, business: the productIds order
    expect(hrefs).toEqual(productIds.map((id) => `/quote?type=${id}`));
  });
});

describe("HowItWorks", () => {
  it("has a heading, three ordered steps and a quote link", async () => {
    const { container } = await render(<HowItWorks />);
    await expect
      .element(page.getByRole("heading", { level: 2 }))
      .toHaveTextContent("From quote to covered in minutes");
    expect(container.querySelectorAll("ol > li")).toHaveLength(3);
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
  });

  it("lazy-loads a decorative photo with its size set", async () => {
    const { container } = await render(<HowItWorks />);
    const img = container.querySelector("picture img")!;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("alt")).toBe("");
    expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(0);
    expect(container.querySelector('picture source[type="image/avif"]')).not.toBeNull();
  });
});

describe("QuickActions", () => {
  it("links each tile and the account link to its page", async () => {
    await render(<QuickActions />);
    const expected: [RegExp, string][] = [
      [/^Make a claim/, "/claims/new"],
      [/^Track a claim/, "/claims/track"],
      [/^Get your documents/, "/account/documents"],
      [/^Make a payment/, "/account/payments"],
      [/^Go to your account$/, "/account"],
    ];
    for (const [name, href] of expected) {
      await expect.element(page.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});

describe("ClosingCta", () => {
  it("links to the quote and to a saved quote", async () => {
    await render(<ClosingCta />);
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
    await expect
      .element(page.getByRole("link", { name: "Continue a saved quote" }))
      .toHaveAttribute("href", "/quote/retrieve");
  });
});

describe("ExcessCallout", () => {
  // Found by selector, not role: Playwright maps an <aside> inside a <section> to generic even when
  // it's named, though browsers expose a named one as complementary (HTML-AAM)
  const callout = 'aside[aria-label="Example excess"]';

  it("sits over the hero photo, showing the example excess", async () => {
    await page.viewport(1280, 800);
    const { container } = await render(<Hero />);
    const aside = container.querySelector<HTMLElement>(`.hero__media ${callout}`)!;
    await expect.element(aside).toBeVisible();
    expect(aside.textContent).toContain("£250");
  });

  it("is hidden on mobile, where it would cover the photo", async () => {
    await page.viewport(390, 800);
    const { container } = await render(<Hero />);
    await expect.element(container.querySelector<HTMLElement>(callout)!).not.toBeVisible();
  });
});

describe("LandingPage", () => {
  it("has one h1, then the section h2s in Figma order", async () => {
    const { container } = await render(<LandingPage />);
    const headings = [...container.querySelectorAll("h1, h2, h3, h4")].map(
      (h) => `${h.tagName} ${h.textContent}`,
    );
    expect(headings).toEqual([
      "H1 Kerb Online Insurance.",
      "H2 Insurance for every situation",
      "H2 From quote to covered in minutes",
      "H2 Already with Kerb?",
      "H2 See your price in two minutes.",
    ]);
  });
});
