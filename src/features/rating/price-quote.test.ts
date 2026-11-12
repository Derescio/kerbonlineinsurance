import { describe, expect, it } from "vite-plus/test";

import { businessV1 } from "#/server/reference/rating/business-v1";
import { carV1 } from "#/server/reference/rating/car-v1";
import { homeV1 } from "#/server/reference/rating/home-v1";

import { priceQuote, splitBundleDiscount, type QuoteItemRequest } from "./price-quote";
import { businessInputs, carInputs, flatCar, flatHome, homeInputs } from "./test-tables";
import type { CarInputs, HomeInputs, RatingData } from "./types";

const carItem = (
  tables: RatingData = carV1,
  inputs: CarInputs = carInputs(),
  coverLevel: QuoteItemRequest["coverLevel"] = "comprehensive",
): QuoteItemRequest => ({ product: "car", inputs, tables, coverLevel, addons: [] });
const homeItem = (
  tables: RatingData = homeV1,
  inputs: HomeInputs = homeInputs(),
): QuoteItemRequest => ({
  product: "home",
  inputs,
  tables,
  coverLevel: "comprehensive",
  addons: [],
});

// Flat tables priced to a round figure: car base × 1 = base; home 240 × buildings rate × 1
const carAt = (pence: number) => flatCar({ parameters: { base_rate_pence: pence } });
const homeAt = (buildingsRate: number, min?: number) =>
  flatHome({
    parameters: {
      buildings_rate_pence: buildingsRate,
      contents_rate_pence: 0,
      ...(min === undefined ? {} : { min_premium_pence: min }),
    },
  });

function expectSums(quote: ReturnType<typeof priceQuote>) {
  expect(quote.subtotalPence - quote.bundleDiscountPence + quote.feesPence + quote.iptPence).toBe(
    quote.totalPence,
  );
  const items = quote.items.flatMap((i) => (i.selected ? [i.selected.totalPence] : []));
  expect(items.reduce((a, b) => a + b, 0)).toBe(quote.totalPence);
}

describe("splitBundleDiscount", () => {
  it("splits in proportion", () => {
    // (60000 + 30000) × 0.08 = 7200; home 7200 × 30000 / 90000 = 2400; car takes 7200 − 2400 = 4800
    const split = splitBundleDiscount(
      [
        { product: "car", premiumPence: 60_000 },
        { product: "home", premiumPence: 30_000 },
      ],
      0.08,
    );
    expect(split.get("car")).toBe(4_800);
    expect(split.get("home")).toBe(2_400);
  });

  it("gives the leftover penny to the larger item", () => {
    // 50000 × 0.08 = 4000; home round(4000 × 16667 / 50000) = round(1333.36) = 1333; car 2667
    const split = splitBundleDiscount(
      [
        { product: "car", premiumPence: 33_333 },
        { product: "home", premiumPence: 16_667 },
      ],
      0.08,
    );
    expect(split.get("car")).toBe(2_667);
    expect(split.get("home")).toBe(1_333);
  });
});

describe("priceQuote", () => {
  it("bundles car and home: discount, then IPT on what's left", () => {
    // car 33333; home 166.67 × 100 = 16667 (rebuild £166,670, contents rated at 0)
    const quote = priceQuote([
      carItem(carAt(33_333)),
      homeItem(homeAt(100), homeInputs({ rebuildCostPence: 16_667_000 })),
    ]);
    const [car, home] = quote.items;
    // shares 2667 and 1333 (above); car IPT round(30666 × 0.12) = 3680; home round(15334 × 0.12) = 1840
    expect(car!.selected).toMatchObject({
      premiumPence: 33_333,
      discountPence: 2_667,
      iptPence: 3_680,
    });
    expect(home!.selected).toMatchObject({
      premiumPence: 16_667,
      discountPence: 1_333,
      iptPence: 1_840,
    });
    // totals: 30666 + 3680 = 34346; 15334 + 1840 = 17174; together 51520
    expect(car!.selected!.totalPence).toBe(34_346);
    expect(home!.selected!.totalPence).toBe(17_174);
    expect(quote).toMatchObject({
      subtotalPence: 50_000,
      bundleDiscountPence: 4_000,
      feesPence: 0,
      iptPence: 5_520,
      totalPence: 51_520,
    });
    expectSums(quote);
  });

  it("lets the discount take a premium at the minimum below it", () => {
    // home 240 × 10 = 2400, raised to the 12000 minimum; car 60000; discount round(72000 × 0.08) = 5760
    // home share round(5760 × 12000 / 72000) = 960 → 11040; IPT round(11040 × 0.12) = 1324.8 → 1325
    const quote = priceQuote([carItem(carAt(60_000)), homeItem(homeAt(10, 12_000))]);
    const home = quote.items[1]!.selected!;
    expect(home.premiumPence).toBe(12_000);
    expect(home.discountPence).toBe(960);
    expect(home.iptPence).toBe(1_325);
    expectSums(quote);
  });

  it("has no bundle unless car and home are both quoted", () => {
    const referredHome = homeInputs({ pastClaims: 3 });
    const a = priceQuote([carItem(carAt(60_000)), homeItem(homeAt(125), referredHome)]);
    expect(a.bundleDiscountPence).toBe(0);
    expect(a.items[1]).toMatchObject({
      outcome: "referred",
      reasonCode: "past_claims",
      selected: null,
    });
    // A referred item adds nothing: the car alone, 60000 + round(60000 × 0.12) = 67200
    expect(a.totalPence).toBe(67_200);

    const b = priceQuote([
      carItem(carAt(60_000), carInputs({ pastClaims: 3 })),
      homeItem(homeAt(125)),
    ]);
    expect(b.bundleDiscountPence).toBe(0);
    expectSums(b);
  });

  it("has no bundle for one product, or for business with home", () => {
    expect(priceQuote([carItem()]).bundleDiscountPence).toBe(0);
    expect(
      priceQuote([
        homeItem(),
        {
          product: "business",
          inputs: businessInputs(),
          tables: businessV1,
          coverLevel: "comprehensive",
          addons: [],
        },
      ]).bundleDiscountPence,
    ).toBe(0);
  });

  it("refers a chosen tier above the maximum, and quotes one that fits", () => {
    // base 700000 × comprehensive 1 = 700000 > max 600000; essential 700000 × 0.8 = 560000 fits
    const tables = flatCar({
      parameters: { base_rate_pence: 700_000 },
      tiers: { essential: 0.8, comprehensive: 1, plus: 1.2 },
    });
    expect(priceQuote([carItem(tables)]).items[0]).toMatchObject({
      outcome: "referred",
      reasonCode: "premium_above_max",
      selected: null,
    });
    expect(
      priceQuote([carItem(tables, carInputs(), "essential")]).items[0]!.selected!.premiumPence,
    ).toBe(560_000);
  });

  it("declines a Crown dependency without rating it", () => {
    const quote = priceQuote([carItem(carV1, carInputs({ postcodeArea: "JE" }))]);
    expect(quote.items[0]).toMatchObject({
      outcome: "declined",
      reasonCode: "outside_cover_area",
      options: [],
      selected: null,
    });
    expect(quote.totalPence).toBe(0);
  });

  it("carries the driver a rule named", () => {
    const tesla = carInputs({
      vehicle: { ...carInputs().vehicle, insuranceGroup: 32 },
      namedDrivers: [{ age: 19, licenceYears: 1 }],
    });
    expect(priceQuote([carItem(carV1, tesla)]).items[0]).toMatchObject({
      outcome: "declined",
      driver: 1,
    });
  });

  it("adds selected add-ons before IPT", () => {
    // business v1 legal_expenses = 4500 a year with no factors
    const quote = priceQuote([
      {
        product: "business",
        inputs: businessInputs(),
        tables: businessV1,
        coverLevel: "comprehensive",
        addons: ["legal_expenses"],
      },
    ]);
    const item = quote.items[0]!.selected!;
    expect(item.addonsPence).toBe(4_500);
    // IPT on premium + add-ons, rounded once
    expect(item.iptPence).toBe(Math.round((item.premiumPence + 4_500) * 0.12));
    expectSums(quote);
  });

  it("sums exactly for each product alone", () => {
    for (const item of [carItem(), homeItem()]) expectSums(priceQuote([item]));
  });

  it("refuses two items of one product", () => {
    expect(() => priceQuote([carItem(), carItem()])).toThrow("two car items");
  });

  it("records the version it priced with", () => {
    const tables = { ...carV1, id: "v-1" };
    expect(priceQuote([carItem(tables)]).items[0]!.ratingVersionId).toBe("v-1");
    expect(priceQuote([carItem()]).items[0]!.ratingVersionId).toBeNull();
  });
});
