import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { CarCard, DetailsTabs, HelpCard, StepNav } from "./page-kit";

// The revamp's shared page parts (5.4b, calls 5–9)

describe("DetailsTabs", () => {
  const states = {
    car: "done",
    about: "done",
    driving: "current",
    claims: "open",
    drivers: "locked",
  } as const;

  it("makes done and open steps buttons, and the current and locked ones plain", async () => {
    const onOpen = vi.fn();
    await render(<DetailsTabs states={states} onOpen={onOpen} />);
    const tabs = page.getByRole("navigation", { name: "Your details" });

    await tabs.getByRole("button", { name: "Car, done" }).click();
    expect(onOpen).toHaveBeenLastCalledWith("car");
    await tabs.getByRole("button", { name: "Claims" }).click();
    expect(onOpen).toHaveBeenLastCalledWith("claims");

    await expect
      .element(tabs.getByRole("listitem").filter({ hasText: "Driving" }))
      .toHaveAttribute("aria-current", "step");
    await expect.element(tabs.getByRole("button", { name: /Driving/ })).not.toBeInTheDocument();
    await expect.element(tabs.getByRole("listitem").filter({ hasText: "Drivers" })).toBeVisible();
    await expect.element(tabs.getByRole("button", { name: /Drivers/ })).not.toBeInTheDocument();
  });
});

describe("DetailsTabs scrolling (5.4b, call 12)", () => {
  const states = {
    car: "done",
    about: "done",
    driving: "current",
    claims: "open",
    drivers: "locked",
  } as const;

  it("never scrolls the page when it renders again", async () => {
    const screen = await render(
      <div>
        <DetailsTabs states={{ ...states }} onOpen={() => {}} />
        <div style={{ height: 3000 }} />
      </div>,
    );
    window.scrollTo(0, 2000);
    const before = window.scrollY;
    expect(before).toBeGreaterThan(0);
    await screen.rerender(
      <div>
        <DetailsTabs states={{ ...states }} onOpen={() => {}} />
        <div style={{ height: 3000 }} />
      </div>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(window.scrollY).toBe(before);
  });
});

describe("CarCard", () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it("shows only what's chosen so far, with the postcode", async () => {
    await render(<CarCard car={{ make: "Tesla" }} postcode="E8 3RL" />);
    await expect.element(page.getByText("Tesla", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Postcode E8 3RL")).toBeVisible();
    await expect.element(page.getByText(/doors/)).not.toBeInTheDocument();
  });

  it("shows the whole car, and Change calls back", async () => {
    await page.viewport(1280, 900);
    const onChange = vi.fn();
    await render(
      <CarCard
        car={{
          make: "Tesla",
          model: "Model 3",
          variant: "RWD",
          year: 2024,
          fuelType: "electric",
          doors: 4,
        }}
        postcode="E8 3RL"
        onChange={onChange}
      />,
    );
    await expect.element(page.getByText("Tesla Model 3 RWD")).toBeVisible();
    await expect.element(page.getByText("2024 · Electric · 4 doors")).toBeVisible();
    await page.getByRole("button", { name: "Change car or postcode" }).click();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("is one line at phone width: the name, postcode and Change", async () => {
    await page.viewport(360, 800);
    await render(
      <CarCard
        car={{ make: "Tesla", model: "Model 3", variant: "RWD", year: 2024, doors: 4 }}
        postcode="E8 3RL"
        onChange={() => {}}
      />,
    );
    await expect.element(page.getByText("Tesla Model 3 RWD")).toBeVisible();
    await expect.element(page.getByText("2024 · 4 doors")).not.toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Change car or postcode" }))
      .toBeVisible();
  });

  it("shows only the postcode before a car is chosen", async () => {
    await render(<CarCard car={null} postcode="E8 3RL" />);
    await expect.element(page.getByText("Postcode E8 3RL")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Change car or postcode" }))
      .not.toBeInTheDocument();
  });
});

describe("HelpCard", () => {
  it("has the default title and Contact us to the inbox", async () => {
    await render(<HelpCard>Keep your documents nearby.</HelpCard>);
    await expect
      .element(page.getByRole("heading", { name: "A little help along the way" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Contact us" }))
      .toHaveAttribute("href", "mailto:hello@kerb.opsedsolutions.com");
  });
});

describe("StepNav", () => {
  it("puts Back before the next button", async () => {
    const onBack = vi.fn();
    await render(<StepNav onBack={onBack} next={<button type="submit">Next</button>} />);
    await page.getByRole("button", { name: "Back" }).click();
    expect(onBack).toHaveBeenCalledOnce();
    await expect.element(page.getByRole("button", { name: "Next" })).toBeVisible();
  });
});
