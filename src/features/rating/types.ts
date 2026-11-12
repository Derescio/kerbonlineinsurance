import type { CoverLevel } from "#/server/db/schema/values";
import type { RatingSource } from "#/server/reference/rating/types";

// The rating engine's inputs and outputs (5.4). The engine reads a version's tables as data: a 4.8
// source file or the tables loaded from the database (which add `id`) both fit RatingData.

export type RatingData = Readonly<Omit<RatingSource, "notes"> & { id?: string }>;

export interface CarDriver {
  age: number;
  licenceYears: number;
}

/** No field here may describe a sensitive characteristic (spec decision 8) */
export interface CarInputs {
  vehicle: { year: number; insuranceGroup: number; fuelType: string; valuePence: number };
  driver: CarDriver & { occupation: string; noClaimsYears: number };
  /** In the order entered: eligibility names the first one a rule hits */
  namedDrivers: CarDriver[];
  /** Every driver's claims in the last 5 years (spec decision 5) */
  pastClaims: number;
  postcodeArea: string;
  annualMileage: number;
  usage: string;
  overnightLocation: string;
  voluntaryExcessPence: number;
}

export interface HomeInputs {
  postcodeArea: string;
  propertyType: string;
  yearBuilt: number;
  bedrooms: number;
  rebuildCostPence: number;
  contentsValuePence: number;
  hasAlarm: boolean;
  hasSmokeAlarm: boolean;
  lockType: string;
  pastClaims: number;
}

export interface BusinessInputs {
  tradeClass: string;
  postcodeArea: string;
  turnoverPence: number;
  employees: number;
}

export type RatingInputs =
  | { product: "car"; inputs: CarInputs }
  | { product: "home"; inputs: HomeInputs }
  | { product: "business"; inputs: BusinessInputs };

export interface PricedFactor {
  factor: string;
  inputValue: string;
  multiplier: number;
}

export interface PricedOption {
  coverLevel: CoverLevel;
  coverMultiplier: number;
  compulsoryExcessPence: number;
  /** Before IPT */
  annualPremiumPence: number;
  /** Before IPT, with the monthly credit charge (4.2's column) */
  monthlyPremiumPence: number;
}

export interface PricedAddon {
  addon: string;
  annualPricePence: number;
  monthlyPricePence: number;
}

/** A risk rated but not yet priced per tier */
export interface Rated {
  /** Before the tier multiplier, unrounded */
  base: number;
  factors: PricedFactor[];
  /** Added to every tier's compulsory excess */
  extraExcessPence: number;
  addons: PricedAddon[];
}
