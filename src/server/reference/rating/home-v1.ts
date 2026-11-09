import { choices, postcodeBands, postcodeLookups, ranges } from "./build";
import type { RatingSource } from "./types";

// Home rating v1, combined buildings and contents (4.8, spec "Rating tables v1"). Kerb's own
// estimates, calibrated to the ABI's Q2–Q3 2026 combined average and comparison-site quotes, not
// any insurer's actual rates. Never edit once deployed: add home v2 instead (call 9).

export const homeV1: RatingSource = {
  product: "home",
  version: 1,
  effectiveFrom: "2026-11-01",
  notes:
    "v1 (4.8): calibrated to ABI Q2–Q3 2026 and comparison-site figures; see plan/phases/04-data-auth/08-reference-data.md",
  parameters: {
    // Per £1,000 of rebuild cost and of contents
    buildings_rate_pence: 75,
    contents_rate_pence: 190,
    min_premium_pence: 12_000,
    max_premium_pence: 500_000,
    ipt_rate: 0.12,
    fee_pence: 0,
    monthly_credit_charge_rate: 0.1,
    bundle_discount_rate: 0.08,
    // Shown in the cover content
    escape_of_water_excess_pence: 35_000,
    subsidence_excess_pence: 100_000,
    refer_rebuild_pence_min: 100_000_000,
    decline_rebuild_pence_min: 250_000_000,
    refer_contents_pence_min: 15_000_000,
    // Built before 1750
    refer_year_built_max: 1_749,
    refer_past_claims_min: 3,
  },
  tiers: [
    { coverLevel: "essential", multiplier: 0.9, compulsoryExcessPence: 10_000 },
    { coverLevel: "comprehensive", multiplier: 1, compulsoryExcessPence: 10_000 },
    { coverLevel: "plus", multiplier: 1.2, compulsoryExcessPence: 5_000 },
  ],
  addons: [
    { addon: "home_emergency", annualPricePence: 7_200, factors: [], availableToGroups: null },
    { addon: "legal_expenses", annualPricePence: 3_000, factors: [], availableToGroups: null },
    // £2,500 unspecified, away from home
    {
      addon: "personal_possessions",
      annualPricePence: 4_800,
      factors: [],
      availableToGroups: null,
    },
  ],
  factors: [
    // Buildings. A flat's structure is usually the freeholder's to insure
    ...choices("property_type", {
      detached: 1.05,
      semi: 1,
      terraced: 0.97,
      bungalow: 0.95,
      flat: 0.85,
    }),
    ...ranges("year_built", [
      ["before 1900", 0, 1_899, 1.25],
      ["1900-1945", 1_900, 1_945, 1.12],
      ["1946-1979", 1_946, 1_979, 1.03],
      ["1980-1999", 1_980, 1_999, 1],
      ["2000+", 2_000, null, 0.95],
    ]),
    ...postcodeBands("buildings_postcode_band"),
    // Contents
    ...postcodeBands("contents_postcode_band"),
    ...choices("burglar_alarm", { yes: 0.95, no: 1 }),
    ...choices("lock_type", { standard: 1.05, five_lever: 0.95, multipoint: 0.95 }),
    ...choices("smoke_alarm", { yes: 1, no: 1.05 }),
    ...ranges("bedrooms", [
      ["0-2", 0, 2, 0.95],
      ["3", 3, 3, 1],
      ["4", 4, 4, 1.06],
      ["5+", 5, null, 1.12],
    ]),
    // Both sections, last 5 years; 3 or more is referred anyway
    ...ranges("past_claims", [
      ["0", 0, 0, 1],
      ["1", 1, 1, 1.2],
      ["2", 2, 2, 1.45],
      ["3+", 3, null, 1.45],
    ]),
  ],
  lookups: [
    ...postcodeLookups("buildings_postcode_band", (area) => area.buildings),
    ...postcodeLookups("contents_postcode_band", (area) => area.contents),
  ],
};
