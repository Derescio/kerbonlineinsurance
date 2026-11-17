import { describe, expect, it } from "vite-plus/test";

import { bundleLive, composeBundle, prefillAbout, samePerson } from "./bundle";
import type { CoverPrices } from "./cover";
import { PRICES } from "./cover-fixtures";
import { DEFAULT_COVER } from "./journey-store";
import { completeHomeJourney, completeJourney } from "./journey-fixtures";

/** A home price: home v1's tiers and add-ons, no voluntary excess */
const HOME_PRICES: CoverPrices = {
  voluntaryExcessPence: 0,
  levels: [
    {
      coverLevel: "essential",
      outcome: "quoted",
      premiumPence: 21_000,
      compulsoryExcessPence: 25_000,
    },
    {
      coverLevel: "comprehensive",
      outcome: "quoted",
      premiumPence: 24_000,
      compulsoryExcessPence: 25_000,
    },
    { coverLevel: "plus", outcome: "quoted", premiumPence: 29_000, compulsoryExcessPence: 15_000 },
  ],
  addons: [
    { addon: "home_emergency", annualPricePence: 3_600 },
    { addon: "legal_expenses", annualPricePence: 2_400 },
  ],
  iptRate: 0.12,
  feePence: 0,
  monthlyCreditChargeRate: 0.1,
  bundleDiscountRate: 0.08,
};

const carCover = { ...DEFAULT_COVER, addons: ["breakdown_uk"] };
const homeCover = { ...DEFAULT_COVER, addons: ["home_emergency"] };

describe("bundleLive (5.7b, decision 1)", () => {
  const car = { ...completeJourney(), cover: DEFAULT_COVER };
  const home = { ...completeHomeJourney(), bundle: { carJourneyId: car.journeyId } };

  it("is on when the mark matches a car journey with a chosen cover", () => {
    expect(bundleLive(car, home)).toBe(true);
  });

  it("is off for another car journey, no car journey, no mark or no car cover", () => {
    expect(bundleLive({ ...car, journeyId: crypto.randomUUID() }, home)).toBe(false);
    expect(bundleLive(null, home)).toBe(false);
    expect(bundleLive(car, { ...home, bundle: undefined })).toBe(false);
    expect(bundleLive({ ...car, cover: undefined }, home)).toBe(false);
    expect(bundleLive(car, null)).toBe(false);
  });
});

describe("composeBundle (5.7b, decision 4)", () => {
  /** What the engine gives for the same choice: the figures the save stores */
  function engine(carAddons: string[], homeAddons: string[]) {
    const line = (prices: CoverPrices, addons: string[]) => {
      const tier = prices.levels.find((l) => l.coverLevel === "comprehensive")!;
      return {
        premiumPence: tier.premiumPence!,
        addonsPence: prices.addons
          .filter((a) => addons.includes(a.addon))
          .reduce((sum, a) => sum + a.annualPricePence, 0),
      };
    };
    return { car: line(PRICES, carAddons), home: line(HOME_PRICES, homeAddons) };
  }

  it("matches the engine's bundle discount and total, with an extra on each", () => {
    const money = composeBundle(
      { prices: PRICES, cover: carCover },
      { prices: HOME_PRICES, cover: homeCover },
    )!;
    const { car, home } = engine(carCover.addons, homeCover.addons);
    // priceQuote splits 8% of the combined premiums, then adds IPT on each item after its share
    expect(money.savingPence).toBe(Math.round((car.premiumPence + home.premiumPence) * 0.08));
    expect(money.car.discountPence + money.home.discountPence).toBe(money.savingPence);
    const ipt = (n: number) => Math.round(n * 0.12);
    const carNet = car.premiumPence - money.car.discountPence + car.addonsPence;
    const homeNet = home.premiumPence - money.home.discountPence + home.addonsPence;
    expect(money.car.totalPence).toBe(carNet + ipt(carNet));
    expect(money.home.totalPence).toBe(homeNet + ipt(homeNet));
    expect(money.totalPence).toBe(money.car.totalPence + money.home.totalPence);
    expect(money.monthlyPaymentPence).toBe(Math.round((money.totalPence * 1.1) / 12));
  });

  it("is null when either tier can't be chosen", () => {
    expect(
      composeBundle(
        { prices: PRICES, cover: { ...carCover, coverLevel: "plus" } },
        { prices: HOME_PRICES, cover: homeCover },
      ),
    ).toBeNull();
  });

  it("refuses versions with different monthly rates", () => {
    expect(() =>
      composeBundle(
        { prices: PRICES, cover: carCover },
        { prices: { ...HOME_PRICES, monthlyCreditChargeRate: 0.12 }, cover: homeCover },
      ),
    ).toThrow(/monthly/);
  });
});

describe("prefillAbout and samePerson (5.7b, decisions 3 and 6)", () => {
  it("takes car's main driver, or home's About you", () => {
    const car = completeJourney();
    expect(prefillAbout(car)).toEqual({
      firstName: car.mainDriver!.firstName,
      lastName: car.mainDriver!.lastName,
      dateOfBirth: car.mainDriver!.dateOfBirth,
    });
    const home = completeHomeJourney();
    expect(prefillAbout(home)).toEqual(home.homeAbout);
    expect(prefillAbout(null)).toBeUndefined();
  });

  it("compares names trimmed and case-blind, and dates of birth exactly", () => {
    const a = { firstName: "Alex", lastName: "Morgan", dateOfBirth: "1990-04-12" };
    expect(
      samePerson(a, { firstName: " alex ", lastName: "MORGAN", dateOfBirth: "1990-04-12" }),
    ).toBe(true);
    expect(samePerson(a, { ...a, dateOfBirth: "1990-04-13" })).toBe(false);
    expect(samePerson(a, { ...a, lastName: "Morgans" })).toBe(false);
  });
});
