import { afterEach, describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { postcodeError } from "#/features/quote/postcode";

import { Hero } from "./Hero";

// Catch the form's real submit after React's handler has run (window is after the React root),
// record what would be sent, and keep the test page from navigating.
let submitted: { action: string; method: string; postcode: string } | undefined;
function catchSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  if (!e.defaultPrevented) {
    const postcode = new FormData(form).get("postcode");
    submitted = {
      action: new URL(form.action).pathname,
      method: form.method,
      postcode: typeof postcode === "string" ? postcode : "",
    };
  }
  e.preventDefault();
}
window.addEventListener("submit", catchSubmit);
afterEach(() => {
  submitted = undefined;
});

describe("Hero", () => {
  it("has the title, a GET form to /quote and the saved-quote link", async () => {
    const { container } = await render(<Hero />);
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
    await render(<Hero />);
    const field = page.getByRole("textbox", { name: "Your postcode" });
    await field.fill("E8");
    await page.getByRole("button", { name: "Get a quote" }).click();

    expect(submitted).toBeUndefined();
    await expect.element(field).toHaveAttribute("aria-invalid", "true");
    await expect.element(field).toHaveAccessibleDescription(postcodeError);
    await expect.element(field).toHaveFocus();

    await userEvent.type(field, " 3RL");
    await expect.element(field).not.toHaveAttribute("aria-invalid");
  });

  it("submits a valid postcode, normalised", async () => {
    await render(<Hero />);
    await page.getByRole("textbox", { name: "Your postcode" }).fill("  e83rl ");
    await page.getByRole("button", { name: "Get a quote" }).click();
    await expect
      .poll(() => submitted)
      .toEqual({
        action: "/quote",
        method: "get",
        postcode: "E8 3RL",
      });
  });
});

describe("HeroImage", () => {
  it("is a high-priority image with its size set and AVIF/WebP sources", async () => {
    const { container } = await render(<Hero />);
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
