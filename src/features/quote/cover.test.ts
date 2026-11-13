import { describe, expect, it } from "vite-plus/test";

import {
  addonCopy,
  addonWithIpt,
  composeCover,
  isOfferedExcess,
  monthlyTerms,
  usableCover,
} from "./cover";
import { PRICES } from "./cover-fixtures";

describe("composeCover (5.5, decisions 6 and 7)", () => {
  it("adds the chosen extras and IPT, and the lines add up to the total", () => {
    const c = composeCover(PRICES, "comprehensive", ["breakdown_uk"])!;
    // (152088 + 4500) × 0.12 = 18790.56 → 18791; 152088 + 4500 + 18791 = 175379
    expect(c.iptPence).toBe(18_791);
    expect(c.totalPence).toBe(175_379);
    expect(c.premiumPence + c.addons[0]!.annualPricePence + c.feePence + c.iptPence).toBe(
      c.totalPence,
    );
    // 175379 × 1.1 ÷ 12 = 16076.4 → 16076
    expect(c.monthlyPaymentPence).toBe(16_076);
  });

  it("can't compose a tier that's referred", () => {
    expect(composeCover(PRICES, "plus", [])).toBeNull();
  });

  it("works out the monthly lines: the cost, the total payable and the APR", () => {
    const terms = monthlyTerms(composeCover(PRICES, "comprehensive", [])!);
    // 152088 + 18251 IPT = 170339; 170339 × 1.1 ÷ 12 = 15614.4 → 15614; × 12 = 187368
    expect(terms).toEqual({
      paymentPence: 15_614,
      totalPayablePence: 187_368,
      costPence: 17_029,
      apr: 23.6,
    });
  });
});

describe("usableCover", () => {
  it("goes back to Comprehensive from a referred tier, and drops an extra not offered", () => {
    expect(
      usableCover(PRICES, {
        coverLevel: "plus",
        voluntaryExcessPence: 25_000,
        addons: ["motor_legal", "gone"],
      }),
    ).toEqual({
      coverLevel: "comprehensive",
      voluntaryExcessPence: 25_000,
      addons: ["motor_legal"],
    });
  });
});

describe("the extras and the excess", () => {
  it("shows an extra's own price with IPT", () => {
    // 4500 + 540 = 5040; 5040 × 1.1 ÷ 12 = 462
    expect(addonWithIpt(PRICES, 4_500)).toEqual({ annualPence: 5_040, monthlyPence: 462 });
  });

  it("names an extra the copy doesn't know by its name", () => {
    expect(addonCopy("breakdown_uk").label).toBe("Breakdown cover");
    expect(addonCopy("windscreen")).toEqual({ label: "windscreen" });
  });

  it("offers only the band edges", () => {
    expect(isOfferedExcess(25_000)).toBe(true);
    expect(isOfferedExcess(30_000)).toBe(false);
    expect(isOfferedExcess("25000")).toBe(false);
  });
});
