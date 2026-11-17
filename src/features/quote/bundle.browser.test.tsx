import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import type { CarPriceResult, HomePriceResult } from "#/server/quote/price";

import { composeBundle } from "./bundle";
import { GOLF_PRICES } from "./cover-fixtures";
import { HomeSteps } from "./HomeSteps";
import { completeHomeJourney, completeJourney } from "./journey-fixtures";
import { DEFAULT_COVER, journeyKey, readJourney, type Journey } from "./journey-store";
import { formatPounds } from "#/features/rating/money";
import type { HomeQuoteStep } from "./search";
import { priceCar, priceHome } from "./server";

// Home's Choose cover in a bundle (5.7b, decisions 3 and 4): screen 22's panel with the car
// beside the home, or the offer to add car. Prices are mocked at the server-function boundary.

vi.mock("./server", () => ({ priceCar: vi.fn(), priceHome: vi.fn() }));
vi.mock("./BuyGate", () => ({ BuyStep: () => <p>The gate</p> }));
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn(async () => null) }));

const carPrice = vi.mocked(priceCar);
const homePrice = vi.mocked(priceHome);

const CAR: CarPriceResult = { status: "quoted", ...GOLF_PRICES };
const HOME: HomePriceResult = {
  status: "quoted",
  ...GOLF_PRICES,
  levels: GOLF_PRICES.levels.map((l) => ({
    ...l,
    premiumPence: Math.round(l.premiumPence! / 3),
  })),
  addons: [{ addon: "home_emergency", annualPricePence: 7_200 }],
};

const moves: (HomeQuoteStep | undefined)[] = [];
const others: { product: string; postcode: string; step?: string }[] = [];

beforeEach(() => {
  moves.length = 0;
  others.length = 0;
  sessionStorage.clear();
  carPrice.mockReset();
  homePrice.mockReset();
  carPrice.mockResolvedValue(CAR);
  homePrice.mockResolvedValue(HOME);
});

function Harness() {
  const [step, setStep] = useState<HomeQuoteStep | undefined>("cover");
  return step ? (
    <HomeSteps
      step={step}
      postcode="E8 3RL"
      onStep={(next) => {
        moves.push(next);
        setStep(next);
      }}
      onPostcode={() => {}}
      onOtherProduct={(to) => others.push(to)}
    />
  ) : null;
}

function withQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** A car journey with a cover, and a home journey marked as bundled with it (or not) */
function store({ bundled = true, carId }: { bundled?: boolean; carId?: string } = {}) {
  const car: Journey = { ...completeJourney(), cover: DEFAULT_COVER, payment: "annual" };
  const home: Journey = {
    ...completeHomeJourney(),
    cover: DEFAULT_COVER,
    ...(bundled ? { bundle: { carJourneyId: carId ?? car.journeyId } } : {}),
  };
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(car));
  sessionStorage.setItem(journeyKey("home"), JSON.stringify(home));
  return { car, home };
}

const panel = () => page.getByRole("region", { name: "Your car quote" });

describe("home's Choose cover in a bundle (5.7b, decision 4)", () => {
  it("shows the car beside the home, the saving and the combined total", async () => {
    store();
    await withQuery(<Harness />);
    const money = composeBundle(
      { prices: CAR, cover: DEFAULT_COVER },
      { prices: HOME, cover: DEFAULT_COVER },
    )!;
    await expect.element(panel()).toBeVisible();
    await expect.element(panel().getByText(/Comprehensive/)).toBeVisible();
    await expect.element(panel().getByText(formatPounds(money.car.totalPence))).toBeVisible();
    await expect.element(panel().getByText(formatPounds(money.home.totalPence))).toBeVisible();
    await expect.element(panel().getByText(`−${formatPounds(money.savingPence)}`)).toBeVisible();
    await expect
      .element(panel().getByText(`Together: ${formatPounds(money.totalPence)} a year`))
      .toBeVisible();
    await expect
      .element(
        panel().getByText(`Or 12 combined payments of ${formatPounds(money.monthlyPaymentPence)}`),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Continue to sign in" })).toBeVisible();
    expect(page.getByRole("button", { name: "Add car insurance" }).elements()).toHaveLength(0);
  });

  it("sets one way of paying for both", async () => {
    store();
    await withQuery(<Harness />);
    await page.getByText("Pay monthly").click();
    expect(readJourney("car")?.payment).toBe("monthly");
    expect(readJourney("home")?.payment).toBe("monthly");
  });

  it("goes on with home alone, clearing the mark", async () => {
    store();
    await withQuery(<Harness />);
    await userEvent.click(page.getByRole("button", { name: "Continue with home only" }));
    expect(readJourney("home")?.bundle).toBeUndefined();
    expect(moves).toEqual(["buy"]);
  });

  it("goes back to car's Choose cover, keeping the mark", async () => {
    const { car } = store();
    await withQuery(<Harness />);
    await userEvent.click(page.getByRole("button", { name: "Back to car quote" }));
    expect(readJourney("home")?.bundle).toEqual({ carJourneyId: car.journeyId });
    expect(others).toEqual([{ product: "car", postcode: "E8 3RL", step: "cover" }]);
  });
});

describe("home's Choose cover on its own (5.7b, decision 3)", () => {
  it("offers to add car, marking the bundle and opening the car journey", async () => {
    store({ bundled: false });
    sessionStorage.removeItem(journeyKey("car"));
    await withQuery(<Harness />);
    await expect
      .element(page.getByText("Insure your car with us too and save 8% on both."))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Add car insurance" }));
    const car = readJourney("car");
    expect(car?.postcode).toBe("E8 3RL");
    expect(readJourney("home")?.bundle).toEqual({ carJourneyId: car!.journeyId });
    expect(others).toEqual([{ product: "car", postcode: "E8 3RL" }]);
  });

  it("ignores a stale mark: no panel, and the offer shows", async () => {
    store({ carId: crypto.randomUUID() });
    await withQuery(<Harness />);
    await expect.element(page.getByRole("button", { name: "Add car insurance" })).toBeVisible();
    expect(panel().elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: /Continue with/ })).toBeVisible();
  });
});
