import { describe, expect, it } from "vite-plus/test";

import { UK_POSTCODE_AREAS } from "../postcode-areas";
import type { RatingSource } from "./types";
import { REQUIRED_PARAMETERS, validateRatingSource } from "./validate";

// A minimal valid car source: every required parameter, the three tiers, one range factor, one
// categorical factor and a postcode lookup covering all 121 areas.
function validCar(): RatingSource {
  return {
    product: "car",
    version: 1,
    effectiveFrom: "2026-11-01",
    notes: "test",
    parameters: Object.fromEntries(REQUIRED_PARAMETERS.car.map((name) => [name, 1])),
    tiers: [
      { coverLevel: "essential", multiplier: 0.96, compulsoryExcessPence: 25_000 },
      { coverLevel: "comprehensive", multiplier: 1, compulsoryExcessPence: 25_000 },
      { coverLevel: "plus", multiplier: 1.18, compulsoryExcessPence: 15_000 },
    ],
    addons: [
      { addon: "breakdown_uk", annualPricePence: 4_500, factors: [], availableToGroups: null },
    ],
    factors: [
      { factor: "driver_age", band: "17-24", rangeFrom: 17, rangeTo: 24, multiplier: 1.5 },
      { factor: "driver_age", band: "25+", rangeFrom: 25, rangeTo: null, multiplier: 1 },
      { factor: "usage", band: "social", rangeFrom: null, rangeTo: null, multiplier: 0.95 },
      ...Array.from({ length: 10 }, (_, i) => ({
        factor: "postcode_band",
        band: String(i + 1),
        rangeFrom: null,
        rangeTo: null,
        multiplier: 1,
      })),
    ],
    lookups: UK_POSTCODE_AREAS.map((area) => ({
      lookup: "postcode_area" as const,
      factor: "postcode_band",
      key: area,
      label: area,
      group: null,
      band: "5",
    })),
  };
}

function problems(change: (source: RatingSource) => void): string[] {
  const source = validCar();
  change(source);
  return validateRatingSource(source);
}

const driverAge = (source: RatingSource) => source.factors.filter((f) => f.factor === "driver_age");

describe("validateRatingSource", () => {
  it("accepts a valid source", () => {
    expect(validateRatingSource(validCar())).toEqual([]);
  });

  it.each<[string, (source: RatingSource) => void, string]>([
    ["a gap", (s) => void (driverAge(s)[1]!.rangeFrom = 26), "driver_age: gap after 24"],
    ["an overlap", (s) => void (driverAge(s)[0]!.rangeTo = 25), "driver_age: overlap at 25"],
    [
      "a closed top band",
      (s) => void (driverAge(s)[1]!.rangeTo = 99),
      "driver_age: no open-ended top band",
    ],
    [
      "a range above the floor",
      (s) => void (driverAge(s)[0]!.rangeFrom = 18),
      "driver_age: starts at 18, floor is 17",
    ],
    [
      "a lookup to an unknown band",
      (s) => void (s.lookups[0]!.band = "11"),
      "postcode_band: unknown band 11",
    ],
    [
      "a missing area",
      (s) => void (s.lookups = s.lookups.filter((l) => l.key !== "LS")),
      "postcode_band: missing area LS",
    ],
    [
      "an area twice",
      (s) => void s.lookups.push({ ...s.lookups.find((l) => l.key === "LS")! }),
      "postcode_band: area LS listed twice",
    ],
    [
      "a crown dependency",
      (s) => void s.lookups.push({ ...s.lookups[0]!, key: "JE" }),
      "postcode_band: JE is outside the cover area",
    ],
    ["two tiers", (s) => void s.tiers.pop(), "tiers: expected essential, comprehensive, plus"],
    ["a zero multiplier", (s) => void (s.factors[2]!.multiplier = 0), "multiplier must be > 0"],
    [
      "five decimal places",
      (s) => void (s.factors[2]!.multiplier = 1.02201),
      "more than 4 decimal places",
    ],
    [
      "an add-on with an unknown factor",
      (s) => void (s.addons[0]!.factors = ["nope"]),
      "addon breakdown_uk: unknown factor nope",
    ],
    ["a missing parameter", (s) => void delete s.parameters.ipt_rate, "missing parameter ipt_rate"],
    // Final review: limits Postgres would only enforce after writes had started
    [
      "an add-on twice",
      (s) => void s.addons.push({ ...s.addons[0]! }),
      "addon breakdown_uk listed twice",
    ],
    [
      "a multiplier too big for numeric(8,4)",
      (s) => void (s.factors[2]!.multiplier = 10_000),
      "multiplier must be below 10000",
    ],
    [
      "a price too big for an integer column",
      (s) => void (s.addons[0]!.annualPricePence = 2 ** 31),
      "addon breakdown_uk: price too large",
    ],
  ])("refuses %s", (_label, change, message) => {
    expect(problems(change).join("\n")).toContain(message);
  });
});
