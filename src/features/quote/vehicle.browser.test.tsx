import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import type { PickerCar } from "./catalogue";
import { beginJourney, readJourney, setVehicle } from "./journey-store";
import { VehicleStep, type VehicleStepView } from "./VehicleStep";

// The car step (5.2): screens 08, 09 and 10, the demo-plate fill and the car that isn't listed.

const car = (
  id: string,
  make: string,
  model: string,
  year: number,
  variant: string,
): PickerCar => ({
  id,
  make,
  model,
  year,
  variant,
  fuelType: "petrol",
  doors: 5,
  transmission: "manual",
});

const cars = [
  car("golf-21-life", "Volkswagen", "Golf", 2021, "1.0 TSI Life 5dr"),
  car("golf-21-gti", "Volkswagen", "Golf", 2021, "GTI 5dr"),
  car("golf-20-life", "Volkswagen", "Golf", 2020, "1.0 TSI Life 5dr"),
  car("fiesta-19", "Ford", "Fiesta", 2019, "1.0 EcoBoost 125 Titanium 5dr"),
];

const mailto = "mailto:hello@kerb.opsedsolutions.com?subject=Please%20add%20my%20car%20to%20Kerb";

function Harness({ initial }: { initial: VehicleStepView }) {
  const [view, setView] = useState(initial);
  return (
    <>
      <p data-testid="view">{view}</p>
      <VehicleStep view={view} onView={setView} onContinue={() => {}} />
    </>
  );
}

function withCatalogue(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (!client) queryClient.setQueryData(["catalogue"], { cars });
  return queryClient;
}

async function renderStep(initial: VehicleStepView = "plate", client?: QueryClient) {
  return render(
    <QueryClientProvider client={withCatalogue(client)}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const make = () => page.getByRole("combobox", { name: "1 · Make" });
const model = () => page.getByRole("combobox", { name: "2 · Model" });
const year = () => page.getByRole("combobox", { name: "3 · Year first registered" });
const variant = () => page.getByRole("combobox", { name: "4 · Variant" });
const plateBox = () => page.getByRole("textbox", { name: "Car registration" });
const view = () => page.getByTestId("view");

describe("the car step", () => {
  beforeEach(() => {
    sessionStorage.clear();
    beginJourney("car", "E8 3RL");
  });
  afterEach(() => vi.restoreAllMocks());

  it("fills the box from a demo plate without searching", async () => {
    await renderStep();
    await expect
      .element(
        page.getByRole("list", {
          name: "Kerb is a demo, so only these plates are recognised currently. Please choose one:",
        }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "VW21 GQL" }).click();
    await expect.element(plateBox()).toHaveValue("VW21 GQL");
    await expect.element(view()).toHaveTextContent("plate");
  });

  it("finds a demo plate and fills make, model, year and variant in turn", async () => {
    await renderStep();
    await userEvent.fill(plateBox(), "vw21gql");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(view()).toHaveTextContent("manual");
    await expect.element(page.getByText("Car · Your details")).toBeVisible();
    await expect.element(make(), { timeout: 2000 }).toHaveDisplayValue("Volkswagen");
    await expect.element(model(), { timeout: 2000 }).toHaveDisplayValue("Golf");
    await expect.element(year(), { timeout: 2000 }).toHaveDisplayValue("2021");
    await expect.element(variant(), { timeout: 2000 }).toHaveDisplayValue("1.0 TSI Life 5dr");
    await expect.element(page.getByText("Volkswagen Golf 1.0 TSI Life 5dr")).toBeVisible();
    await expect.element(page.getByText("2021 · Petrol · 5 doors")).toBeVisible();
  });

  it("fills everything at once with reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    await renderStep();
    await userEvent.fill(plateBox(), "VW21 GQL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(variant(), { timeout: 100 }).toHaveDisplayValue("1.0 TSI Life 5dr");
  });

  it("stops the fill when the visitor changes the make", async () => {
    await renderStep();
    await userEvent.fill(plateBox(), "VW21 GQL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(make()).toHaveDisplayValue("Volkswagen");
    await userEvent.selectOptions(make(), "Ford");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await expect.element(make()).toHaveDisplayValue("Ford");
    await expect.element(model()).toHaveValue("");
    await expect.element(variant()).toHaveValue("");
  });

  it("sends an unknown plate to screen 10, keeping it there", async () => {
    await renderStep();
    await userEvent.fill(plateBox(), "KR24 BXL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(view()).toHaveTextContent("not-found");
    await expect
      .element(page.getByRole("heading", { name: "We don’t have that car" }))
      .toBeVisible();
    await expect.element(plateBox()).toHaveValue("KR24 BXL");
    expect(readJourney("car")?.lastPlate).toBe("KR24 BXL");
  });

  it("asks for a registration when the box is empty", async () => {
    await renderStep();
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(plateBox()).toHaveAccessibleDescription(/Enter your registration\./);
    await expect.element(view()).toHaveTextContent("plate");
  });

  it("clears the later choices when an earlier one changes", async () => {
    await renderStep("manual");
    await userEvent.selectOptions(make(), "Volkswagen");
    await userEvent.selectOptions(model(), "Golf");
    await userEvent.selectOptions(year(), "2021");
    await userEvent.selectOptions(variant(), "golf-21-gti");
    await userEvent.selectOptions(make(), "Ford");
    await expect.element(model()).toHaveValue("");
    await expect.element(year()).toHaveValue("");
    await expect.element(variant()).toHaveValue("");
  });

  it("only confirms once a variant is chosen, then keeps the car", async () => {
    await renderStep("manual");
    const confirm = page.getByRole("button", { name: "Confirm this car" });
    await expect.element(confirm).toBeDisabled();
    await userEvent.selectOptions(make(), "Volkswagen");
    await userEvent.selectOptions(model(), "Golf");
    await userEvent.selectOptions(year(), "2021");
    await expect.element(confirm).toBeDisabled();
    await userEvent.selectOptions(variant(), "golf-21-life");
    await confirm.click();
    await expect
      .element(page.getByText(/^Your car: Volkswagen Golf 1\.0 TSI Life 5dr, 2021\./))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(readJourney("car")?.vehicle).toMatchObject({
      catalogueVariantId: "golf-21-life",
      make: "Volkswagen",
      year: 2021,
      fuelType: "petrol",
      doors: 5,
    });
  });

  it("reopens the picker with the car chosen after Change", async () => {
    await renderStep("manual");
    await userEvent.selectOptions(make(), "Ford");
    await userEvent.selectOptions(model(), "Fiesta");
    await userEvent.selectOptions(year(), "2019");
    await userEvent.selectOptions(variant(), "fiesta-19");
    await page.getByRole("button", { name: "Confirm this car" }).click();
    await page.getByRole("button", { name: "Change your car" }).click();
    await expect.element(variant()).toHaveValue("fiesta-19");
    expect(readJourney("car")?.vehicle).toBeUndefined();
  });

  it("shows the demo message and email link for a car that isn't listed", async () => {
    await renderStep("manual");
    await page.getByRole("button", { name: "My car isn’t listed" }).click();
    await expect
      .element(page.getByText(/Kerb is a demo with a limited list of cars\./))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "hello@kerb.opsedsolutions.com" }))
      .toHaveAttribute("href", mailto);
  });

  it("forgets a stored car that's no longer in the catalogue", async () => {
    setVehicle({
      catalogueVariantId: "gone",
      make: "Volkswagen",
      model: "Golf",
      year: 2012,
      variant: "1.4 S 5dr",
      fuelType: "petrol",
      doors: 5,
    });
    await renderStep();
    await expect.element(page.getByRole("heading", { name: "Let’s find your car" })).toBeVisible();
    await vi.waitFor(() => expect(readJourney("car")?.vehicle).toBeUndefined());
  });

  it("shows a stored car that's still listed", async () => {
    setVehicle({
      catalogueVariantId: "golf-21-life",
      make: "Volkswagen",
      model: "Golf",
      year: 2021,
      variant: "1.0 TSI Life 5dr",
      fuelType: "petrol",
      doors: 5,
    });
    await renderStep();
    await expect
      .element(page.getByText(/^Your car: Volkswagen Golf 1\.0 TSI Life 5dr, 2021\./))
      .toBeVisible();
  });

  function holdCatalogue() {
    let release = () => {};
    vi.spyOn(window, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ cars }));
        }),
    );
    return () => release();
  }
  const emptyClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("waits for the list of cars when Find is pressed early, then finds the plate", async () => {
    const release = holdCatalogue();
    await renderStep("plate", emptyClient());
    await userEvent.fill(plateBox(), "VW21 GQL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(page.getByRole("button", { name: "Loading cars…" })).toBeVisible();
    release();
    await expect.element(view()).toHaveTextContent("manual");
    await expect.element(variant(), { timeout: 2000 }).toHaveDisplayValue("1.0 TSI Life 5dr");
  });

  it("drops a waiting Find when the visitor chooses manually instead", async () => {
    const release = holdCatalogue();
    await renderStep("plate", emptyClient());
    await userEvent.fill(plateBox(), "KR24 BXL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await page.getByRole("button", { name: "I don’t know the registration" }).click();
    await expect.element(view()).toHaveTextContent("manual");
    release();
    await expect.element(make()).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect.element(view()).toHaveTextContent("manual");
    await expect.element(make()).toHaveValue("");
  });

  it("moves focus to the new screen's heading", async () => {
    await renderStep();
    await userEvent.fill(plateBox(), "KR24 BXL");
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect
      .element(page.getByRole("heading", { name: "We don’t have that car" }))
      .toHaveFocus();
    await page.getByRole("button", { name: "Choose my car manually" }).click();
    await expect.element(page.getByRole("heading", { name: "Choose your car" })).toHaveFocus();
  });

  it("puts focus on the empty registration box", async () => {
    await renderStep();
    await page.getByRole("button", { name: "Find my car" }).click();
    await expect.element(plateBox()).toHaveFocus();
  });

  it("doesn't move focus when a stored car appears on load", async () => {
    setVehicle({
      catalogueVariantId: "golf-21-life",
      make: "Volkswagen",
      model: "Golf",
      year: 2021,
      variant: "1.0 TSI Life 5dr",
      fuelType: "petrol",
      doors: 5,
    });
    await renderStep();
    const heading = page.getByRole("heading", { name: "Your car" });
    await expect.element(heading).toBeVisible();
    await expect.element(heading).not.toHaveFocus();
  });

  it("says when the list of cars can't load, and tries again", async () => {
    const fetch = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ cars }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderStep("manual", client);
    // One retry (catalogueQuery), then the message
    await expect
      .element(page.getByText("We couldn’t load the list of cars. Try again in a moment."), {
        timeout: 5000,
      })
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(make()).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
