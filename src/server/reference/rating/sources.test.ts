import { describe, expect, it } from "vite-plus/test";

import { STATUS_OCCUPATIONS } from "#/features/quote/occupation";

import { expandCatalogue } from "../catalogue/expand";
import { CATALOGUE_SOURCES } from "../catalogue/index";
import { CALIBRATION_PEOPLE } from "./calibration";
import { carV1 } from "./car-v1";
import { homeV1 } from "./home-v1";
import { homeV2 } from "./home-v2";
import { RATING_SOURCES } from "./index";
import type { RatingSource } from "./types";
import { validateRatingSource } from "./validate";

const source = (product: RatingSource["product"]) =>
  RATING_SOURCES.find((s) => s.product === product)!;
/** The version a new quote is priced with: home v2 from 5.7c */
const latest = (product: RatingSource["product"]) =>
  RATING_SOURCES.filter((s) => s.product === product).reduce((a, b) =>
    b.version > a.version ? b : a,
  );
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
  it("has version 1 of car, home and business, then home v2", () => {
    expect(RATING_SOURCES.map((s) => [s.product, s.version])).toEqual([
      ["car", 1],
      ["home", 1],
      ["business", 1],
      ["home", 2],
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

describe("home v2 (5.7c, decision 4)", () => {
  const occupations = (s: RatingSource) => s.lookups.filter((l) => l.lookup === "occupation");

  it("is valid, and starts after v1", () => {
    expect(validateRatingSource(homeV2)).toEqual([]);
    expect(homeV2.effectiveFrom > homeV1.effectiveFrom).toBe(true);
  });

  it("reads car v1's occupation bands", () => {
    expect(occupations(homeV2)).toEqual(occupations(carV1));
  });

  it("is v1 plus the occupation factor", () => {
    expect(
      homeV2.factors
        .filter((f) => f.factor === "occupation_band")
        .map((f) => [f.band, f.multiplier]),
    ).toEqual([
      ["A", 0.95],
      ["B", 0.97],
      ["C", 1],
      ["D", 1.03],
      ["E", 1.06],
    ]);
    expect(homeV2.version).toBe(2);
    expect(homeV2.notes).toMatch(/5\.7c/);
    expect(homeV2.parameters).toEqual(homeV1.parameters);
    expect(homeV2.tiers).toEqual(homeV1.tiers);
    expect(homeV2.addons).toEqual(homeV1.addons);
    expect(homeV2.factors.filter((f) => f.factor !== "occupation_band")).toEqual(homeV1.factors);
    expect(homeV2.lookups.filter((l) => l.lookup !== "occupation")).toEqual(homeV1.lookups);
  });
});

describe("CALIBRATION_PEOPLE", () => {
  it("has the spec's twelve people, and 5.7c's H4", () => {
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
      "H4",
      "B1",
      "B2",
      "B3",
    ]);
  });

  it.each(CALIBRATION_PEOPLE.map((p) => [p.id, p] as const))(
    "%s uses lookup keys that exist in its product's latest version",
    (_id, person) => {
      const keys = new Set(latest(person.product).lookups.map((l) => `${l.lookup}:${l.key}`));
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
