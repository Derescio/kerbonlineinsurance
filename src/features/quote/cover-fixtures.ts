import type { CoverPrices } from "./cover";

// A car price at £0 voluntary excess, Plus referred over the maximum (5.5 tests)

export const PRICES: CoverPrices = {
  voluntaryExcessPence: 0,
  levels: [
    {
      coverLevel: "essential",
      outcome: "quoted",
      premiumPence: 146_004,
      compulsoryExcessPence: 25_000,
    },
    {
      coverLevel: "comprehensive",
      outcome: "quoted",
      premiumPence: 152_088,
      compulsoryExcessPence: 25_000,
    },
    { coverLevel: "plus", outcome: "referred", premiumPence: null, compulsoryExcessPence: 15_000 },
  ],
  addons: [
    { addon: "breakdown_uk", annualPricePence: 4_500 },
    { addon: "motor_legal", annualPricePence: 2_500 },
  ],
  iptRate: 0.12,
  feePence: 0,
  monthlyCreditChargeRate: 0.1,
  bundleDiscountRate: 0.08,
};

/** The fixture journey's price at £0 voluntary excess (5.5's integration test works it out) */
export const GOLF_PRICES: CoverPrices = {
  voluntaryExcessPence: 0,
  levels: [
    {
      coverLevel: "essential",
      outcome: "quoted",
      premiumPence: 91_181,
      compulsoryExcessPence: 25_000,
    },
    {
      coverLevel: "comprehensive",
      outcome: "quoted",
      premiumPence: 94_980,
      compulsoryExcessPence: 25_000,
    },
    { coverLevel: "plus", outcome: "quoted", premiumPence: 112_076, compulsoryExcessPence: 15_000 },
  ],
  addons: [
    { addon: "breakdown_uk", annualPricePence: 4_500 },
    { addon: "motor_legal", annualPricePence: 2_500 },
  ],
  iptRate: 0.12,
  feePence: 0,
  monthlyCreditChargeRate: 0.1,
  bundleDiscountRate: 0.08,
};
