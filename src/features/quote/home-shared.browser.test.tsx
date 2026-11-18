import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { getSessionUser } from "#/features/auth/session";
import type { HomePriceResult } from "#/server/quote/price";
import { renderWithRouter } from "#/test/router";

import { BuyStep } from "./BuyGate";
import { ChooseCover } from "./ChooseCover";
import { GOLF_PRICES } from "./cover-fixtures";
import { completeHomeJourney } from "./journey-fixtures";
import { journeyKey } from "./journey-store";
import { priceHome } from "./server";

// The shared screens for a home quote (5.7, decision 11): Choose cover with home's levels and no
// voluntary excess, and the gate's home overline and "Your cover is waiting". The price is mocked
// at the server-function boundary.

vi.mock("./server", () => ({ priceHome: vi.fn(), saveHomeQuoteFn: vi.fn() }));
vi.mock("#/features/auth/session", () => ({ getSessionUser: vi.fn() }));

const price = vi.mocked(priceHome);
const session = vi.mocked(getSessionUser);

const QUOTED: HomePriceResult = {
  status: "quoted",
  ...GOLF_PRICES,
  addons: [
    { addon: "home_emergency", annualPricePence: 7_200 },
    { addon: "legal_expenses", annualPricePence: 3_000 },
    { addon: "personal_possessions", annualPricePence: 4_800 },
  ],
};

const noop = () => {};

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  price.mockResolvedValue(QUOTED);
  session.mockResolvedValue(null);
  sessionStorage.setItem(journeyKey("home"), JSON.stringify(completeHomeJourney()));
});

function withQuery(ui: React.ReactNode, path = "/quote/home?postcode=E8+3RL&step=cover") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    path,
  );
}

describe("Choose cover for a home", () => {
  it("compares home's levels and extras, with no voluntary excess", async () => {
    await withQuery(
      <ChooseCover
        product="home"
        journey={completeHomeJourney()}
        aside={null}
        onBack={noop}
        onContinue={noop}
        onSaveAndExit={noop}
        onCover={noop}
        onNotQuoted={noop}
        onInvalid={noop}
      />,
    );
    await expect.element(page.getByText("Home insurance / Choose cover")).toBeVisible();
    // The cards carry the comparison rows at phone width, where the table is hidden
    const essential = page.getByRole("radio", { name: "Essential", exact: true });
    await expect.element(essential.getByText(/^Buildings cover/)).toBeVisible();
    await expect.element(essential.getByText(/Not included: Accidental damage/)).toBeVisible();
    expect(
      page
        .getByRole("radio", { name: "Comprehensive", exact: true })
        .getByText(/Not included/)
        .elements(),
    ).toHaveLength(0);
    await expect.element(page.getByText(/Home emergency cover/)).toBeVisible();
    await expect.element(page.getByText(/Family legal protection/)).toBeVisible();
    expect(page.getByLabelText("Voluntary excess").elements()).toHaveLength(0);
    expect(price).toHaveBeenCalledWith({
      data: { journey: expect.anything(), voluntaryExcessPence: 0 },
    });
  });
});

describe("the gate for a home", () => {
  it("names home insurance and the address in Your cover is waiting", async () => {
    await withQuery(
      <BuyStep
        product="home"
        journey={completeHomeJourney()}
        after="pay"
        onBack={noop}
        onCover={noop}
        onNotQuoted={noop}
        onInvalid={noop}
      />,
      "/quote/home?postcode=E8+3RL&step=buy",
    );
    await expect.element(page.getByText("Home insurance / Buy")).toBeVisible();
    const waiting = page.getByRole("region", { name: "Your cover is waiting" });
    await expect.element(waiting.getByText("18 Albion Road, Hackney")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Create an account" }))
      .toHaveAttribute("href", expect.stringContaining("/quote/home?"));
  });
});
