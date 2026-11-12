import { businessV1 } from "#/server/reference/rating/business-v1";
import { carV1 } from "#/server/reference/rating/car-v1";
import { homeV1 } from "#/server/reference/rating/home-v1";
import type { RatingSource } from "#/server/reference/rating/types";

import type { BusinessInputs, CarInputs, HomeInputs, RatingData } from "./types";

// Hand-checkable tables for the engine's tests: a v1 source with every factor and tier multiplier
// set to 1, then the few a test needs set by name. Expected values can then be worked by hand.

export interface Flat {
  parameters?: Record<string, number>;
  /** Every band of the named factor gets this multiplier */
  multipliers?: Record<string, number>;
  /** Tier multipliers by cover level */
  tiers?: Record<string, number>;
  /** Parameters to remove, for the config-error tests */
  without?: string[];
}

export function flat(source: RatingSource, opts: Flat = {}): RatingData {
  const parameters: Record<string, number> = { ...source.parameters, ...opts.parameters };
  for (const name of opts.without ?? []) delete parameters[name];
  return {
    ...source,
    parameters,
    tiers: source.tiers.map((t) => ({ ...t, multiplier: opts.tiers?.[t.coverLevel] ?? 1 })),
    factors: source.factors.map((f) => ({ ...f, multiplier: opts.multipliers?.[f.factor] ?? 1 })),
  };
}

export const flatCar = (opts?: Flat) => flat(carV1, opts);
export const flatHome = (opts?: Flat) => flat(homeV1, opts);
export const flatBusiness = (opts?: Flat) => flat(businessV1, opts);

export function carInputs(overrides: Partial<CarInputs> = {}): CarInputs {
  return {
    vehicle: { year: 2020, insuranceGroup: 14, fuelType: "petrol", valuePence: 2_000_000 },
    driver: { age: 30, licenceYears: 10, occupation: "teacher", noClaimsYears: 5 },
    namedDrivers: [],
    pastClaims: 0,
    postcodeArea: "LS",
    annualMileage: 8_000,
    usage: "commuting",
    overnightLocation: "driveway",
    voluntaryExcessPence: 0,
    ...overrides,
  };
}

export function homeInputs(overrides: Partial<HomeInputs> = {}): HomeInputs {
  return {
    postcodeArea: "LS",
    propertyType: "semi",
    yearBuilt: 1990,
    bedrooms: 3,
    rebuildCostPence: 24_000_000,
    contentsValuePence: 4_500_000,
    hasAlarm: false,
    hasSmokeAlarm: true,
    lockType: "multipoint",
    pastClaims: 0,
    ...overrides,
  };
}

export function businessInputs(overrides: Partial<BusinessInputs> = {}): BusinessInputs {
  return {
    tradeClass: "accountant",
    postcodeArea: "LS",
    turnoverPence: 15_000_000,
    employees: 2,
    ...overrides,
  };
}
