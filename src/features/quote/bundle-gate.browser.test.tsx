import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { getSessionUser } from "#/features/auth/session";
import type { WriteResult } from "#/lib/validation";
import type { SaveBundleResult } from "#/server/quote/save";
import { renderWithRouter } from "#/test/router";

import { formatPounds } from "#/features/rating/money";

import { composeBundle } from "./bundle";
import { BuyStep } from "./BuyGate";
import { GOLF_PRICES } from "./cover-fixtures";
import { completeHomeJourney, completeJourney } from "./journey-fixtures";
import {
  DEFAULT_COVER,
  journeyKey,
  readJourney,
  savedQuoteKey,
  type Journey,
} from "./journey-store";
import { priceCar, priceHome, saveBundleQuoteFn, saveHomeQuoteFn } from "./server";

// The gate in a bundle (5.7b, decisions 6 and 7): signed in, it saves both journeys as one quote
// and goes on to pay; each of the save's other answers goes where the visitor can act on it.

vi.mock("./server", () => ({
  priceCar: vi.fn(),
  priceHome: vi.fn(),
  saveBundleQuoteFn: vi.fn(),
  saveHomeQuoteFn: vi.fn(),
}));
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn() }));

const saveBundle = vi.mocked(saveBundleQuoteFn);
const saveHome = vi.mocked(saveHomeQuoteFn);
const session = vi.mocked(getSessionUser);

const USER = { id: "u-1", email: "alex@example.com", name: "Alex Morgan" } as Awaited<
  ReturnType<typeof getSessionUser>
>;

const car: Journey = { ...completeJourney(), cover: DEFAULT_COVER };
const home: Journey = {
  ...completeHomeJourney(),
  cover: DEFAULT_COVER,
  bundle: { carJourneyId: car.journeyId },
};

const result = (data: SaveBundleResult): WriteResult<SaveBundleResult> => ({ ok: true, data });

const invalids: string[] = [];
const carMoves: (string | undefined)[] = [];
const notQuoted: string[] = [];

beforeEach(() => {
  invalids.length = 0;
  carMoves.length = 0;
  notQuoted.length = 0;
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.mocked(priceCar).mockResolvedValue({ status: "quoted", ...GOLF_PRICES });
  vi.mocked(priceHome).mockResolvedValue({ status: "quoted", ...GOLF_PRICES });
  session.mockResolvedValue(USER);
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(car));
  sessionStorage.setItem(journeyKey("home"), JSON.stringify(home));
});

function show(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    "/quote/home?postcode=E8+3RL&step=buy",
  );
}

const gate = (bundled = true) => (
  <BuyStep
    product="home"
    journey={home}
    after="pay"
    bundle={bundled ? { car, onCar: (step) => carMoves.push(step) } : undefined}
    onBack={() => {}}
    onCover={() => {}}
    onNotQuoted={(status) => notQuoted.push(status)}
    onInvalid={(step) => invalids.push(step)}
  />
);

describe("the gate in a bundle (5.7b)", () => {
  it("saves both journeys as one quote, then goes on to pay", async () => {
    saveBundle.mockResolvedValue(result({ status: "saved", quoteId: "q-1", reference: "KRB-Q-1" }));
    const { router } = await show(gate());
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-1");
    const sent = saveBundle.mock.calls[0]![0] as {
      data: { input: { car: Journey; home: Journey } };
    };
    expect(sent.data.input.car.journeyId).toBe(car.journeyId);
    expect(sent.data.input.home.journeyId).toBe(home.journeyId);
    expect(saveHome).not.toHaveBeenCalled();
    expect(readJourney("home")?.saved).toEqual({
      quoteId: "q-1",
      key: `${savedQuoteKey(car)}:${savedQuoteKey(home)}`,
    });
  });

  it("lists the car and the home in Your cover is waiting", async () => {
    session.mockResolvedValue(null);
    await show(gate());
    const waiting = page.getByRole("region", { name: "Your cover is waiting" });
    await expect.element(waiting.getByText("18 Albion Road, Hackney")).toBeVisible();
    await expect.element(waiting.getByText(/Volkswagen Golf/)).toBeVisible();
  });

  it("shows both together at the bundle's price, as screen 22 did (final review 3)", async () => {
    session.mockResolvedValue(null);
    await show(gate());
    const money = composeBundle(
      { prices: GOLF_PRICES, cover: DEFAULT_COVER },
      { prices: GOLF_PRICES, cover: DEFAULT_COVER },
    )!;
    const waiting = page.getByRole("region", { name: "Your cover is waiting" });
    await expect
      .element(waiting.getByText(`Together: ${formatPounds(money.totalPence)} a year`))
      .toBeVisible();
  });

  it("says the two policyholders don't match, and goes back to About you", async () => {
    saveBundle.mockResolvedValue(result({ status: "mismatch" }));
    await show(gate());
    await expect
      .element(page.getByText("Your name and date of birth must match your car quote."))
      .toBeVisible();
    await page.getByRole("button", { name: "Check your details" }).click();
    expect(invalids).toEqual(["about"]);
  });

  it("sends a car answer that no longer passes back to the car journey", async () => {
    saveBundle.mockResolvedValue(result({ status: "invalid", product: "car", step: "claims" }));
    await show(gate());
    await expect.poll(() => carMoves).toEqual(["claims"]);
  });

  it("sends a home that can't be bought to Your quote, which shows 03 or 04", async () => {
    saveBundle.mockResolvedValue(
      result({ status: "not_quoted", product: "home", outcome: "declined" }),
    );
    await show(gate());
    await expect.poll(() => notQuoted).toEqual(["declined"]);
  });

  it("saves home alone when the mark is stale", async () => {
    saveHome.mockResolvedValue({
      ok: true,
      data: { status: "saved", quoteId: "q-2", reference: "KRB-Q-2", outcome: "quoted" },
    });
    const { router } = await show(gate(false));
    await expect.poll(() => router.state.location.pathname).toBe("/quote/pay/q-2");
    expect(saveBundle).not.toHaveBeenCalled();
  });
});
