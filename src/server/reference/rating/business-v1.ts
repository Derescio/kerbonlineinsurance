import { choices, listLookups, postcodeBands, postcodeLookups, ranges } from "./build";
import type { RatingSource } from "./types";

// Business rating v1 (4.8, spec "Rating tables v1"): public liability by tier (£1m/£2m/£5m),
// employers' liability per employee (required by law with employees, £10m limit), optional sections
// as add-ons. Calibrated to Simply Business, PolicyBee and MoneySuperMarket 2025–26 figures; Kerb's
// own estimates, not any insurer's rates. Never edit once deployed: add business v2 instead.

export const businessV1: RatingSource = {
  product: "business",
  version: 1,
  effectiveFrom: "2026-11-01",
  notes:
    "v1 (4.8): calibrated to Simply Business, PolicyBee and MoneySuperMarket figures; see plan/phases/04-data-auth/08-reference-data.md",
  parameters: {
    min_premium_pence: 5_500,
    max_premium_pence: 2_000_000,
    ipt_rate: 0.12,
    fee_pence: 0,
    monthly_credit_charge_rate: 0.1,
    bundle_discount_rate: 0.08,
    // Over £5m turnover
    refer_turnover_pence_min: 500_000_000,
    refer_employees_min: 51,
    // Band E trades with more than 10 employees
    refer_high_risk_employees_min: 11,
    // Pounds, not multipliers, so they're parameters; the trade's band picks one
    pl_rate_pence_a: 6_000,
    pl_rate_pence_b: 8_500,
    pl_rate_pence_c: 11_500,
    pl_rate_pence_d: 17_000,
    pl_rate_pence_e: 26_000,
    el_rate_pence_a: 4_500,
    el_rate_pence_b: 8_000,
    el_rate_pence_c: 15_000,
    el_rate_pence_d: 21_000,
    el_rate_pence_e: 30_000,
  },
  // The tier sets the public liability limit: £1m, £2m, £5m
  tiers: [
    { coverLevel: "essential", multiplier: 1, compulsoryExcessPence: 25_000 },
    { coverLevel: "comprehensive", multiplier: 1.15, compulsoryExcessPence: 25_000 },
    { coverLevel: "plus", multiplier: 1.4, compulsoryExcessPence: 10_000 },
  ],
  // Fixed sums insured in v1: contents and stock £10,000, tools £2,500, business interruption up to
  // £100,000 gross profit, professional indemnity £250,000
  addons: [
    {
      addon: "contents_stock",
      annualPricePence: 9_500,
      factors: ["postcode_band"],
      availableToGroups: null,
    },
    {
      addon: "tools",
      annualPricePence: 12_000,
      factors: [],
      availableToGroups: ["trades_construction"],
    },
    {
      addon: "business_interruption",
      annualPricePence: 6_000,
      factors: ["turnover_band"],
      availableToGroups: null,
    },
    {
      addon: "professional_indemnity",
      annualPricePence: 18_000,
      factors: ["turnover_band"],
      availableToGroups: ["office_professional"],
    },
    { addon: "legal_expenses", annualPricePence: 4_500, factors: [], availableToGroups: null },
  ],
  factors: [
    // In pence; over £5m is referred
    ...ranges("turnover_band", [
      ["up to 50k", 0, 5_000_000, 0.85],
      ["50k-100k", 5_000_001, 10_000_000, 1],
      ["100k-250k", 10_000_001, 25_000_000, 1.2],
      ["250k-500k", 25_000_001, 50_000_000, 1.45],
      ["500k-1m", 50_000_001, 100_000_000, 1.8],
      ["1m-2.5m", 100_000_001, 250_000_000, 2.4],
      ["2.5m+", 250_000_001, null, 3.2],
    ]),
    // The band picks pl_rate_pence_<band> and el_rate_pence_<band>; the multiplier is neutral
    ...choices("trade_band", { A: 1, B: 1, C: 1, D: 1, E: 1 }),
    ...postcodeBands("postcode_band"),
  ],
  lookups: [
    // Business uses home's contents band: theft and damage (call 13)
    ...postcodeLookups("postcode_band", (area) => area.contents),
    // Keys are stored as businesses.trade_class
    ...listLookups("trade", "trade_band", [
      {
        band: "A",
        group: "office_professional",
        items: [
          ["accountant", "Accountant"],
          ["it_consultant", "IT consultant"],
          ["management_consultant", "Management consultant"],
          ["marketing_consultant", "Marketing consultant"],
          ["graphic_designer", "Graphic designer"],
        ],
      },
      { band: "B", group: "office_professional", items: [["architect", "Architect"]] },
      {
        band: "B",
        group: "retail",
        items: [
          ["clothing_shop", "Clothing shop"],
          ["convenience_store", "Convenience store"],
          ["florist", "Florist"],
          ["bookshop", "Bookshop"],
        ],
      },
      {
        band: "C",
        group: "food_hospitality",
        items: [
          ["cafe", "Café"],
          ["restaurant", "Restaurant"],
          ["mobile_caterer", "Mobile caterer"],
        ],
      },
      {
        band: "D",
        group: "food_hospitality",
        items: [
          ["takeaway", "Takeaway"],
          ["pub", "Pub"],
        ],
      },
      {
        band: "B",
        group: "hair_beauty_wellbeing",
        items: [
          ["hairdresser", "Hairdresser"],
          ["barber", "Barber"],
          ["beauty_therapist", "Beauty therapist"],
          ["personal_trainer", "Personal trainer"],
          ["dog_groomer", "Dog groomer"],
        ],
      },
      { band: "B", group: "trades_construction", items: [["cleaner", "Cleaner"]] },
      {
        band: "C",
        group: "trades_construction",
        items: [
          ["electrician", "Electrician"],
          ["plumber", "Plumber"],
          ["painter_decorator", "Painter and decorator"],
          ["carpenter", "Carpenter"],
          ["gardener", "Gardener"],
          ["plasterer", "Plasterer"],
        ],
      },
      { band: "D", group: "trades_construction", items: [["builder", "Builder"]] },
      {
        band: "E",
        group: "trades_construction",
        items: [
          ["roofer", "Roofer"],
          ["scaffolder", "Scaffolder"],
        ],
      },
    ]),
  ],
};
