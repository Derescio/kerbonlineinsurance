import { afterEach, describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { postcodeError } from "#/features/quote/postcode";
import { renderWithRouter } from "#/test/router";

import { Hero } from "./Hero";

// With JavaScript the form never submits: a valid postcode navigates inside the app (5.1, call 8).
// Any real submit that slips through is recorded and stopped, so the tests can say it didn't happen.
let submitted = false;
window.addEventListener("submit", (e) => {
  if (!e.defaultPrevented) submitted = true;
  e.preventDefault();
});
afterEach(() => {
  submitted = false;
});

const render = async () => (await renderWithRouter(<Hero />)).screen;

describe("Hero", () => {
  it("has the title, a GET form to /quote and the saved-quote link", async () => {
    const { container } = await render();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Insurance made simpler.");
    await expect
      .element(page.getByRole("heading", { level: 2, name: "Let's get you covered." }))
      .toBeVisible();
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/quote");
    await expect
      .element(page.getByRole("textbox", { name: "Your postcode" }))
      .toHaveAttribute("name", "postcode");
    await expect
      .element(page.getByRole("link", { name: "Continue a saved quote" }))
      .toHaveAttribute("href", "/quote/retrieve");
  });

  it("blocks an invalid postcode, explains why and focuses the field", async () => {
    await render();
    const field = page.getByRole("textbox", { name: "Your postcode" });
    await field.fill("E8");
    await page.getByRole("button", { name: "Get a quote" }).click();

    expect(submitted).toBe(false);
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
    await expect.element(field).toHaveAccessibleDescription(postcodeError);
    await expect.element(field).toHaveFocus();

    await userEvent.type(field, " 3RL");
    await expect.element(field).not.toHaveAttribute("aria-invalid");
  });

  it("navigates to the quote start with a valid postcode, normalised", async () => {
    const { router } = await renderWithRouter(<Hero />);
    await page.getByRole("textbox", { name: "Your postcode" }).fill("  e83rl ");
    await page.getByRole("button", { name: "Get a quote" }).click();
    await expect.poll(() => router.state.location.pathname).toBe("/quote");
    expect(router.state.location.search).toEqual({ postcode: "E8 3RL" });
    expect(submitted).toBe(false);
  });
});

describe("HeroImage", () => {
  it("is a high-priority image with its size set and AVIF/WebP sources", async () => {
    const { container } = await render();
    const img = container.querySelector("picture img")!;
    expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(0);
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("alt")).toBe("");

    for (const type of ["image/avif", "image/webp"]) {
      const source = container.querySelector(`picture source[type="${type}"]`);
      expect(source, type).not.toBeNull();
      expect(source!.getAttribute("srcset")!.split(",")).toHaveLength(4);
      expect(source!.getAttribute("sizes")).toBeTruthy();
    }
  });
});
