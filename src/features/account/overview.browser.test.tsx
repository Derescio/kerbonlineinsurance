import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import type { NextPayment } from "#/server/data/policies";
import { renderWithRouter } from "#/test/router";

import { Overview } from "./Overview";
import { policy } from "./overview.fixtures";

// The Overview (6.1; Figma 01 258:3608, 02 258:3635, 03 258:3659), from its data. The shell is
// tested in account-shell.browser.test.tsx.

const now = new Date("2026-11-18T09:00:00Z");
const due: NextPayment = { kind: "due", amountPence: 4_470, dueOn: "2026-12-01" };

function show(props: Partial<Parameters<typeof Overview>[0]> = {}) {
  return renderWithRouter(
    <Overview
      name="Maya Patel"
      policies={[]}
      nextPayment={{ kind: "none" }}
      now={now}
      {...props}
    />,
    "/account",
  );
}

const stat = (label: string) => page.getByRole("group", { name: label });
/** Text somewhere in an element, not its whole text */

describe("Overview, frame 01: a car + home bundle", () => {
  const bundle = { id: "b1", savingPence: 9_600 };
  const car = policy({ id: "car", bundle, annualPremiumPence: 53_640 });
  const home = policy({
    id: "home",
    product: "home",
    coverLevel: "plus",
    bundle,
    annualPremiumPence: 54_780,
    label: { kind: "home", line1: "11 Rosebery Gardens", town: "London" },
  });

  it("greets with the date and says you’re covered", async () => {
    await show({ policies: [car, home], nextPayment: due });
    await expect.element(page.getByText("Wednesday 18 November")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Hi Maya, you’re covered.");
  });

  it("has the three stat cards, and no Open claims yet", async () => {
    await show({ policies: [car, home], nextPayment: due });
    await expect.element(stat("Policies").getByText("2")).toBeVisible();
    await expect.element(stat("Next payment").getByText("£44.70")).toBeVisible();
    await expect.element(stat("Next payment").getByText("on 1 Dec")).toBeVisible();
    await expect
      .element(stat("Next payment").getByRole("link", { name: "Manage payments" }))
      .toHaveAttribute("href", "/account/billing");
    await expect.element(stat("A year").getByText("£1,084.20")).toBeVisible();
    await expect.element(stat("A year").getByText("after your £96.00 bundle saving")).toBeVisible();
    await expect.element(page.getByText("Open claims")).not.toBeInTheDocument();
  });

  it("lists the bundle with its saving, the car by plate and the home by address", async () => {
    await show({ policies: [car, home], nextPayment: due });
    const policies = page.getByRole("region", { name: "Your policies" });
    await expect.element(policies.getByText("Car + home bundle")).toBeVisible();
    await expect.element(policies.getByText("You save £96.00 a year")).toBeVisible();
    await expect.element(policies.getByText("KR24 BXL")).toBeVisible();
    await expect.element(policies.getByText("Volkswagen Golf")).toBeVisible();
    await expect.element(policies.getByText("Comprehensive")).toBeVisible();
    await expect.element(policies.getByText("11 Rosebery Gardens, London")).toBeVisible();
    await expect.element(policies.getByText("Active").first()).toBeVisible();
    await expect.element(policies.getByText("Renews 14 Mar 2027").first()).toBeVisible();
    await expect
      .element(policies.getByRole("link", { name: "Your saved quotes" }))
      .toHaveAttribute("href", "/quote/retrieve");
  });

  it("has no add-product card (6.1b)", async () => {
    await show({ policies: [car, home], nextPayment: due });
    await expect.element(page.getByText(/Add (car|home) insurance/)).not.toBeInTheDocument();
  });
});

describe("Overview, frame 02: one lapsed policy", () => {
  const lapsed = policy({ status: "lapsed" });

  it("drops ‘you’re covered’, says Payment due, and explains the lapse", async () => {
    await show({ policies: [lapsed], nextPayment: { kind: "overdue", outstandingPence: 4_470 } });
    const greeting = page.getByRole("heading", { level: 1 });
    await expect.element(greeting).toHaveTextContent("Hi Maya");
    await expect.element(greeting).not.toHaveTextContent("covered");
    await expect.element(stat("Policies").getByText("1")).toBeVisible();
    await expect.element(stat("Next payment").getByText("Payment due")).toBeVisible();
    await expect.element(stat("Next payment").getByText("£44.70 outstanding")).toBeVisible();
    await expect.element(stat("A year").getByText("£536.40")).toBeVisible();
    await expect.element(page.getByText("Lapsed")).toBeVisible();
    await expect
      .element(
        page.getByText("Your payment didn’t go through. Update your card to restart your cover."),
      )
      .toBeVisible();
    await expect.element(page.getByText(/^Renews/)).not.toBeInTheDocument();
  });
});

describe("Overview, frame 03: no policies yet", () => {
  it("has no stat cards, and offers a quote", async () => {
    await show();
    const greeting = page.getByRole("heading", { level: 1 });
    await expect.element(greeting).toHaveTextContent("Hi Maya");
    await expect.element(greeting).not.toHaveTextContent("covered");
    await expect.element(stat("Policies")).not.toBeInTheDocument();
    await expect.element(page.getByText("You don’t have any policies yet.")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Get a quote" }))
      .toHaveAttribute("href", "/quote");
    await expect
      .element(page.getByRole("link", { name: "Your saved quotes" }))
      .toHaveAttribute("href", "/quote/retrieve");
  });
});

describe("Overview, other cases", () => {
  it("says all paid, with no Manage payments, for someone who paid for the year", async () => {
    await show({ policies: [policy({ monthly: false })] });
    await expect.element(stat("Next payment").getByText("All paid for this year")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Manage payments" }))
      .not.toBeInTheDocument();
  });

  it("shows a car with no plate by make and model only", async () => {
    await show({
      policies: [policy({ label: { kind: "car", plate: null, make: "Tesla", model: "Model 3" } })],
      nextPayment: due,
    });
    await expect.element(page.getByText("Tesla Model 3")).toBeVisible();
    expect(document.querySelector(".kb-plate")).toBeNull();
  });

  it("greets without a name when there isn't one", async () => {
    await show({ name: "   ", policies: [policy()] });
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Hi, you’re covered.");
  });

  it("greets a one-word name, and doesn't count a cancelled policy", async () => {
    await show({ name: "Cher", policies: [policy(), policy({ id: "p2", status: "cancelled" })] });
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Hi Cher, you’re covered.");
    await expect.element(stat("Policies").getByText("1")).toBeVisible();
    await expect.element(page.getByText("Cancelled")).toBeVisible();
  });
});
