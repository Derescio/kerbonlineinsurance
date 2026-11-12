import { describe, expect, it } from "vite-plus/test";

import type { CoverLevel, Product } from "#/server/db/schema/values";
import { expandCatalogue } from "#/server/reference/catalogue/expand";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { CALIBRATION_PEOPLE, type CalibrationPerson } from "#/server/reference/rating/calibration";
import { RATING_SOURCES } from "#/server/reference/rating/index";

import { priceQuote, type QuoteItemRequest } from "./price-quote";
import type { RatingInputs } from "./types";

// 4.8's example people (call 22), priced by priceQuote(): inside the market target and within 1% of
// the spec's hand price, since the hand figures round at each step. A miss is fixed with a v2 of the
// product's tables, never by editing v1 (spec decision 12).

const catalogue = expandCatalogue(CATALOGUE_SOURCES);
const sourceFor = (product: Product) => RATING_SOURCES.find((s) => s.product === product)!;

interface PersonCar {
  make: string;
  model: string;
  year: number;
  variant: string;
  insuranceGroup: number;
  valuePence?: number;
}

/** The example people's loosely typed inputs, in the engine's shape */
function request(person: CalibrationPerson): QuoteItemRequest {
  const raw = person.inputs as Record<string, unknown> & {
    coverLevel: CoverLevel;
    addons?: string[];
  };
  const { coverLevel, addons = [], ...rest } = raw;
  let rating: RatingInputs;
  if (person.product === "car") {
    const vehicle = rest.vehicle as PersonCar;
    const driver = rest.driver as {
      age: number;
      occupation: string;
      licenceYears: number;
      noClaimsYears: number;
      pastClaims: number;
    };
    const named = rest.namedDriver as { age: number } | undefined;
    // The people name their car but not its fuel: the catalogue has it (C4, a Tesla, is electric)
    const row = catalogue.find(
      (r) =>
        r.make === vehicle.make &&
        r.model === vehicle.model &&
        r.year === vehicle.year &&
        r.variant === vehicle.variant,
    );
    if (!row)
      throw new Error(`${person.id}: ${vehicle.make} ${vehicle.model} isn't in the catalogue`);
    rating = {
      product: "car",
      inputs: {
        vehicle: {
          year: vehicle.year,
          insuranceGroup: vehicle.insuranceGroup,
          fuelType: row.fuelType,
          valuePence: vehicle.valuePence ?? row.valuePence,
        },
        driver: {
          age: driver.age,
          occupation: driver.occupation,
          licenceYears: driver.licenceYears,
          noClaimsYears: driver.noClaimsYears,
        },
        namedDrivers: named ? [{ age: named.age, licenceYears: Math.max(0, named.age - 17) }] : [],
        pastClaims: driver.pastClaims,
        postcodeArea: rest.postcodeArea as string,
        annualMileage: rest.annualMileage as number,
        usage: rest.usage as string,
        overnightLocation: rest.overnightLocation as string,
        voluntaryExcessPence: rest.voluntaryExcessPence as number,
      },
    };
  } else {
    rating = { product: person.product, inputs: rest } as unknown as RatingInputs;
  }
  return { ...rating, tables: sourceFor(person.product), coverLevel, addons };
}

describe.each(CALIBRATION_PEOPLE)("calibration person $id", (person) => {
  const item = priceQuote([request(person)]).items[0]!;
  const expected = person.expected;

  if (expected.outcome === "quoted") {
    it("is quoted inside the target, near the hand price", () => {
      expect(item.outcome).toBe("quoted");
      const total = item.selected!.totalPence;
      expect(total).toBeGreaterThanOrEqual(expected.minPence);
      expect(total).toBeLessThanOrEqual(expected.maxPence);
      expect(Math.abs(total - expected.handPence) / expected.handPence).toBeLessThanOrEqual(0.01);
    });
  } else {
    it(`is ${expected.outcome} for ${expected.reason}`, () => {
      expect(item.outcome).toBe(expected.outcome);
      expect(item.reasonCode).toBe(expected.reason);
    });
  }
});
