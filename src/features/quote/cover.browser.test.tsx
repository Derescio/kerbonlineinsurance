import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import type { CarPriceResult } from "#/server/quote/price";

import type { CoverPrices } from "./cover";
import { GOLF_PRICES } from "./cover-fixtures";
import { DriverSteps } from "./DriverSteps";
import { completeJourney } from "./journey-fixtures";
import { journeyKey, readJourney, type Journey } from "./journey-store";
import { CarDeclined, HomeDeclinedBundle, HomeReferred, type HomeSummary } from "./Outcomes";
import type { QuoteStep } from "./search";
import { priceCar } from "./server";

// Choose cover, the home offer and the bundle screens (5.5). The price is mocked at the
// server-function boundary: the server's own tests price it, and check the browser composes the
// same money as priceQuote().

vi.mock("./server", () => ({ priceCar: vi.fn() }));
const price = vi.mocked(priceCar);
// The gate (5.6) has its own tests, with a router and a session
vi.mock("./BuyGate", () => ({ BuyStep: () => <p>The gate</p> }));

/** The Golf's prices at an excess: every level × the band's multiplier, as v1 prices them */
function pricesAt(voluntaryExcessPence: number): CarPriceResult {
  const multiplier = { 0: 1, 25_000: 0.95 }[voluntaryExcessPence] ?? 1;
  const prices: CoverPrices = {
    ...GOLF_PRICES,
    voluntaryExcessPence,
    levels: GOLF_PRICES.levels.map((l) => ({
      ...l,
      premiumPence: Math.round(l.premiumPence! * multiplier),
    })),
  };
  return { status: "quoted", ...prices };
}

const moves: { step: QuoteStep | undefined; replace: boolean }[] = [];
beforeEach(() => {
  moves.length = 0;
  sessionStorage.clear();
  price.mockReset();
  price.mockImplementation(async (options) =>
    pricesAt((options as { data: { voluntaryExcessPence: number } }).data.voluntaryExcessPence),
  );
});

function Harness({ initial }: { initial: QuoteStep }) {
  const [step, setStep] = useState<QuoteStep | undefined>(initial);
  return step ? (
    <DriverSteps
      step={step}
      onStep={(next, opts) => {
        moves.push({ step: next, replace: opts?.replace ?? false });
        setStep(next);
      }}
    />
  ) : (
    <p>car step</p>
  );
}

function withQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function show(step: QuoteStep, edit?: (journey: Journey) => void) {
  const journey = completeJourney();
  edit?.(journey);
  sessionStorage.setItem(journeyKey("car"), JSON.stringify(journey));
  return withQuery(<Harness initial={step} />);
}

const heading = () => page.getByRole("heading", { level: 1 });
const card = (name: string) => page.getByRole("radio", { name, exact: true });
const breakdown = () => page.getByRole("region", { name: "How your price is made up" });

describe("Choose cover (5.5)", () => {
  // Desktop width: on a phone the comparison table is hidden (decision 13)
  beforeEach(async () => {
    await page.viewport(1280, 900);
  });
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it("starts on Comprehensive, and a card and the table's column choose the same level", async () => {
    await show("cover");
    await expect.element(heading()).toHaveTextContent("Compare your cover, side by side");
    await expect.element(card("Comprehensive")).toHaveAttribute("aria-checked", "true");
    // Comprehensive at £0: 94980 + 11398 IPT = £1,063.78
    await expect.element(breakdown()).toMatchTextContent("Total if you pay annually£1,063.78");

    await page.getByRole("button", { name: "Plus", exact: true }).click();
    await expect.element(card("Plus")).toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("button", { name: "Plus", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    // Plus: 112076 + 13449 IPT = £1,255.25
    await expect.element(breakdown()).toMatchTextContent("Total if you pay annually£1,255.25");

    await card("Essential").click();
    await expect
      .element(page.getByRole("button", { name: "Essential", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(readJourney("car")?.cover?.coverLevel).toBe("essential");
    await expect
      .element(page.getByRole("button", { name: "Continue with Essential" }))
      .toBeVisible();
  });

  it("shows each level's total excess, and the breakdown spells it out", async () => {
    await show("cover");
    await expect.element(card("Plus")).toHaveAccessibleDescription(/Total excess £150/);
    await expect.element(card("Comprehensive")).toHaveAccessibleDescription(/Total excess £250/);
    await expect
      .element(page.getByText("Total excess £250 (compulsory £250 + voluntary £0)"))
      .toBeVisible();
  });

  it("prices every level again when the excess changes", async () => {
    await show("cover");
    await expect.element(card("Essential")).toHaveAccessibleDescription(/£1,021\.23/);
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Voluntary excess" }),
      "25000",
    );
    // × 0.95: Essential 86622 + 10395 = £970.17, Comprehensive 90231 + 10828 = £1,010.59
    await expect.element(card("Essential")).toHaveAccessibleDescription(/£970\.17/);
    await expect.element(card("Comprehensive")).toHaveAccessibleDescription(/£1,010\.59/);
    await expect
      .element(page.getByText("Total excess £500 (compulsory £250 + voluntary £250)"))
      .toBeVisible();
    expect(price).toHaveBeenCalledTimes(2);
    expect(price.mock.calls[1]![0]).toMatchObject({ data: { voluntaryExcessPence: 25_000 } });
  });

  it("adds an extra to the total and the breakdown without asking the server again", async () => {
    await show("cover");
    await page.getByText("Breakdown cover · £50.40 a year").click();
    await expect
      .element(page.getByRole("checkbox", { name: "Breakdown cover · £50.40 a year" }))
      .toBeChecked();
    // (94980 + 4500) × 1.12 = 99480 + 11938 = £1,114.18
    await expect.element(breakdown()).toMatchTextContent("Breakdown cover£45.00");
    await expect.element(breakdown()).toMatchTextContent("Total if you pay annually£1,114.18");
    await expect.element(card("Comprehensive")).toHaveAccessibleDescription(/£1,114\.18/);
    await expect
      .element(page.getByText("Comprehensive total: £1,114.18 a year or 12 payments of £102.13."))
      .toBeVisible();
    expect(readJourney("car")?.cover?.addons).toEqual(["breakdown_uk"]);
    expect(price).toHaveBeenCalledTimes(1);
  });

  it("adds the cost of paying monthly, the 12 payments and the APR when paying monthly", async () => {
    await show("cover");
    await page.getByText("Pay monthly").click();
    // £1,063.78: 12 payments of £97.51 = £1,170.12, so paying monthly costs £106.34
    await expect.element(breakdown()).toMatchTextContent("Cost of paying monthly (10%)£106.34");
    await expect.element(breakdown()).toMatchTextContent("Total payable£1,170.12");
    await expect.element(breakdown()).toMatchTextContent("12 monthly payments of£97.51");
    await expect.element(breakdown()).toMatchTextContent("Representative APR23.6%");
    await expect.element(card("Comprehensive")).toHaveAccessibleDescription(/£97\.51/);
    await expect
      .element(page.getByRole("checkbox", { name: "Breakdown cover · £4.62 a month" }))
      .toBeVisible();
    expect(readJourney("car")?.payment).toBe("monthly");
  });

  it("keeps the choice through a refresh, and Your quote shows it", async () => {
    const screen = await show("cover");
    await card("Plus").click();
    await page.getByText(/Motor legal protection ·/).click();
    await screen.unmount();
    await withQuery(<Harness initial="cover" />);
    await expect.element(card("Plus")).toHaveAttribute("aria-checked", "true");
    await expect
      .element(page.getByRole("checkbox", { name: /Motor legal protection/ }))
      .toBeChecked();
    await page.getByRole("button", { name: "Back to your quote" }).click();
    await expect.element(heading()).toHaveTextContent("Your quote is ready");
    await expect.element(page.getByRole("heading", { name: "Your Plus price" })).toBeVisible();
    // (112076 + 2500) × 1.12: 114576 + 13749 = £1,283.25
    await expect.element(page.getByText("Total payable £1,283.25")).toBeVisible();
  });

  it("shows a level referred at this excess, and doesn't let it be chosen", async () => {
    price.mockResolvedValue({
      status: "quoted",
      ...GOLF_PRICES,
      levels: GOLF_PRICES.levels.map((l) =>
        l.coverLevel === "plus" ? { ...l, outcome: "referred" as const, premiumPence: null } : l,
      ),
    });
    await show("cover", (j) => {
      j.cover = { coverLevel: "plus", voluntaryExcessPence: 0, addons: [] };
    });
    await expect.element(card("Plus")).toHaveAccessibleDescription(/We’d need to check this level/);
    // The choice goes back to Comprehensive
    await expect.element(card("Comprehensive")).toHaveAttribute("aria-checked", "true");
    await expect.element(card("Plus")).toHaveAttribute("aria-disabled", "true");
    // The arrow keys pass over it without choosing it
    (card("Comprehensive").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(card("Comprehensive")).toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("button", { name: "Plus", exact: true })).toBeDisabled();
  });

  it("sends a quote that isn't quoted back to Your quote", async () => {
    price.mockResolvedValue({ status: "referred", namedDriver: null });
    await show("cover");
    await expect.element(heading()).toHaveTextContent("We need to check a couple of things…");
    expect(moves[0]).toEqual({ step: "quote", replace: true });
  });

  it("sends a journey with an unfinished step to that step", async () => {
    await show("cover", (j) => {
      delete j.claims;
    });
    await expect.element(heading()).toHaveTextContent("Your driving history");
    expect(moves[0]).toEqual({ step: "claims", replace: true });
    expect(price).not.toHaveBeenCalled();
  });

  it("goes back to £0 when the server refuses the excess", async () => {
    price.mockResolvedValueOnce({ status: "invalid", step: "cover" });
    await show("cover", (j) => {
      j.cover = { coverLevel: "comprehensive", voluntaryExcessPence: 30_000, addons: [] };
    });
    await expect.element(breakdown()).toMatchTextContent("Total if you pay annually£1,063.78");
    expect(readJourney("car")?.cover?.voluntaryExcessPence).toBe(0);
  });

  it("hides the table on a phone, where the cards carry the comparison", async () => {
    await page.viewport(393, 852);
    await show("cover");
    await expect.element(card("Plus")).toBeVisible();
    // Hidden from everyone, so it has no role to find it by
    await expect.element(document.querySelector<HTMLElement>(".quote-compare")!).not.toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(393);
  });

  it("continues to the home offer", async () => {
    await show("cover");
    await page.getByRole("button", { name: "Continue with Comprehensive" }).click();
    await expect.element(heading()).toHaveTextContent("Add home insurance to your car quote?");
    expect(moves.at(-1)).toEqual({ step: "add-home", replace: false });
  });
});

describe("Add home insurance (screen 21)", () => {
  it("shows the chosen cover's price and excess, and the postcode carried over", async () => {
    await show("add-home", (j) => {
      j.cover = { coverLevel: "plus", voluntaryExcessPence: 0, addons: [] };
    });
    await expect.element(page.getByText("Your car quote", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Plus · Alex Morgan")).toBeVisible();
    await expect.element(page.getByText("£1,255.25 a year")).toBeVisible();
    await expect.element(page.getByText("£150", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Home postcode" }))
      .toHaveValue("E8 3RL");
    await expect.element(page.getByText(/save 8% on the combined premiums/)).toBeVisible();
    await expect.element(page.getByText(/saved/)).not.toBeInTheDocument();
  });

  it("says home quotes are coming soon for a good postcode, and explains a bad one", async () => {
    await show("add-home");
    const field = page.getByRole("textbox", { name: "Home postcode" });
    await field.fill("E8");
    await page.getByRole("button", { name: "Add home insurance" }).click();
    await expect.element(field).toHaveAccessibleDescription(/Enter your full postcode/);
    await field.fill("n1 9gu");
    await page.getByRole("button", { name: "Add home insurance" }).click();
    await expect.element(page.getByText("Home quotes are coming soon")).toBeVisible();
    await page.getByRole("button", { name: "Back to car quote" }).click();
    expect(moves.at(-1)).toEqual({ step: "cover", replace: false });
  });

  it("goes to the gate with the car only (5.6, decision 2)", async () => {
    await show("add-home");
    await page.getByRole("button", { name: "Continue with car only" }).click();
    expect(moves.at(-1)).toEqual({ step: "buy", replace: false });
    await expect.element(page.getByText("The gate")).toBeVisible();
  });
});

describe("the bundle screens, with sample home answers (screens 03, 04 and 20)", () => {
  const home: HomeSummary = {
    address: "18 Albion Road, London",
    postcode: "E8 3RL",
    cover: "Buildings and contents",
  };
  const aside = <p>aside</p>;

  it("screen 03: a home quote under review, sent for review once signed in", async () => {
    const onCheckAnswers = vi.fn();
    const onSendForReview = vi.fn();
    await render(
      <HomeReferred
        home={home}
        aside={aside}
        onCheckAnswers={onCheckAnswers}
        onSendForReview={onSendForReview}
      />,
    );
    await expect.element(heading()).toHaveTextContent("We need to check a couple of things…");
    await expect.element(page.getByText("18 Albion Road, London")).toBeVisible();
    await expect.element(page.getByText("E8 3RL · Buildings and contents")).toBeVisible();
    await expect.element(page.getByText(/saved/)).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Sign in to send this for review" }).click();
    expect(onSendForReview).toHaveBeenCalled();
    await page.getByRole("button", { name: "Check your answers" }).click();
    expect(onCheckAnswers).toHaveBeenCalled();
  });

  it("screen 04: home declined, the car alone still buyable at its own total", async () => {
    const onContinueCar = vi.fn();
    await render(
      <HomeDeclinedBundle
        home={home}
        car={{
          name: "Volkswagen Golf 1.0 TSI Life 5dr",
          plate: "KR24 BXL",
          coverName: "Comprehensive",
          totalPence: 41_880,
        }}
        aside={aside}
        onCheckHome={vi.fn()}
        onContinueCar={onContinueCar}
      />,
    );
    await expect.element(heading()).toHaveTextContent("Your car quote is still available");
    await expect.element(page.getByText("Home · Not available")).toBeVisible();
    await expect.element(page.getByText("£418.80")).toBeVisible();
    await expect.element(page.getByText("KR24 BXL · Comprehensive cover")).toBeVisible();
    await page.getByRole("button", { name: "Continue with car only" }).click();
    expect(onContinueCar).toHaveBeenCalled();
  });

  it("screen 20 in a bundle: car declined, the home quote still available", async () => {
    const onContinueHome = vi.fn();
    await render(
      <CarDeclined
        journey={completeJourney()}
        home={home}
        aside={aside}
        onCheckAnswers={vi.fn()}
        onContinueHome={onContinueHome}
      />,
    );
    await expect.element(heading()).toHaveTextContent("Your home quote is still available");
    await expect.element(page.getByText("Home · Ready to buy")).toBeVisible();
    await expect.element(page.getByText(/This doesn’t affect your home quote/)).toBeVisible();
    await page.getByRole("button", { name: "Review home quote and continue" }).click();
    expect(onContinueHome).toHaveBeenCalled();
  });

  it("never shows a reason code or threshold", async () => {
    await render(
      <HomeReferred home={home} aside={aside} onCheckAnswers={vi.fn()} onSendForReview={vi.fn()} />,
    );
    const text = document.body.textContent ?? "";
    for (const word of ["premium_above_max", "threshold", "reason"]) {
      expect(text).not.toContain(word);
    }
  });
});
