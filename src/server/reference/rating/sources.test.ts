import { describe, expect, it } from "vite-plus/test";

import { STATUS_OCCUPATIONS } from "#/features/quote/occupation";

import { expandCatalogue } from "../catalogue/expand";
import { CATALOGUE_SOURCES } from "../catalogue/index";
import { CALIBRATION_PEOPLE } from "./calibration";
import { RATING_SOURCES } from "./index";
import type { RatingSource } from "./types";
import { validateRatingSource } from "./validate";

const source = (product: RatingSource["product"]) =>
  RATING_SOURCES.find((s) => s.product === product)!;
const factor = (s: RatingSource, name: string, band: string) =>
  s.factors.find((f) => f.factor === name && f.band === band)!;

describe("the 5.3 status keys", () => {
  it("are occupation keys in car v1", () => {
    const keys = source("car")
      .lookups.filter((l) => l.lookup === "occupation")
      .map((l) => l.key);
    for (const key of [...Object.values(STATUS_OCCUPATIONS), "self_employed"]) {
      expect(keys).toContain(key);
    }
  });
});

describe("RATING_SOURCES v1", () => {
  it("has version 1 of car, home and business", () => {
    expect(RATING_SOURCES.map((s) => [s.product, s.version])).toEqual([
      ["car", 1],
      ["home", 1],
      ["business", 1],
    ]);
  });

  it.each(["car", "home", "business"] as const)("%s v1 is valid", (product) => {
    expect(validateRatingSource(source(product))).toEqual([]);
  });

  it("carries the spec's values", () => {
    const car = source("car");
    expect(car.parameters.base_rate_pence).toBe(46_000);
    expect(factor(car, "insurance_group", "50").multiplier).toBe(2.1418);
    expect(factor(car, "insurance_group", "1").multiplier).toBe(0.7374);
    expect(source("home").parameters.contents_rate_pence).toBe(190);
    const business = source("business");
    expect(business.tiers.find((t) => t.coverLevel === "plus")).toEqual({
      coverLevel: "plus",
      multiplier: 1.4,
      compulsoryExcessPence: 10_000,
    });
    expect(business.addons.find((a) => a.addon === "professional_indemnity")).toMatchObject({
      availableToGroups: ["office_professional"],
      factors: ["turnover_band"],
    });
  });

  it("lists 47 occupations in 5 bands and 30 trades", () => {
    const occupations = source("car").lookups.filter((l) => l.lookup === "occupation");
    expect(occupations).toHaveLength(47);
    expect(new Set(occupations.map((l) => l.band))).toEqual(new Set(["A", "B", "C", "D", "E"]));
    expect(source("business").lookups.filter((l) => l.lookup === "trade")).toHaveLength(30);
  });
});

describe("CALIBRATION_PEOPLE", () => {
  it("has the spec's twelve people", () => {
    expect(CALIBRATION_PEOPLE.map((p) => p.id)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "H1",
      "H2",
      "H3",
      "B1",
      "B2",
      "B3",
    ]);
  });

  it.each(CALIBRATION_PEOPLE.map((p) => [p.id, p] as const))(
    "%s uses lookup keys that exist in its product's v1",
    (_id, person) => {
      const keys = new Set(source(person.product).lookups.map((l) => `${l.lookup}:${l.key}`));
      for (const key of person.lookupKeys) expect(keys.has(key), key).toBe(true);
    },
  );

  it("puts each quoted person's hand figure inside their target", () => {
    for (const person of CALIBRATION_PEOPLE) {
      if (person.expected.outcome !== "quoted") continue;
      const { minPence, maxPence, handPence } = person.expected;
      expect(handPence, person.id).toBeGreaterThanOrEqual(minPence);
      expect(handPence, person.id).toBeLessThanOrEqual(maxPence);
    }
  });

  it("prices each car person on a real catalogue row with its stated group", () => {
    const rows = expandCatalogue(CATALOGUE_SOURCES);
    for (const person of CALIBRATION_PEOPLE.filter((p) => p.product === "car")) {
      const vehicle = person.inputs.vehicle as {
        make: string;
        model: string;
        year: number;
        variant: string;
        insuranceGroup: number;
      };
      const row = rows.find(
        (r) =>
          r.make === vehicle.make &&
          r.model === vehicle.model &&
          r.year === vehicle.year &&
          r.variant === vehicle.variant,
      );
      expect(row, `${person.id} ${vehicle.make} ${vehicle.model} ${vehicle.variant}`).toBeDefined();
      expect(row!.insuranceGroup, person.id).toBe(vehicle.insuranceGroup);
    }
  });
});
