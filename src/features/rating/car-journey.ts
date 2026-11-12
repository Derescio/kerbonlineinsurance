import type { Journey } from "#/features/quote/journey-store";
import { ageOn, wholeYearsBetween } from "#/features/quote/schemas/dates";

import type { CarInputs } from "./types";

// The car journey's answers (5.3) as rating inputs (5.4, spec decision 5). The caller has already
// checked that every step passes; a missing part here is a bug, so it throws.

export interface RatedCar {
  year: number;
  insuranceGroup: number;
  fuelType: string;
  valuePence: number;
}

function need<T>(value: T | undefined, part: string): T {
  if (value === undefined) throw new Error(`carInputsFromJourney: no ${part}`);
  return value;
}

export function carInputsFromJourney(journey: Journey, car: RatedCar, today: string): CarInputs {
  const main = need(journey.mainDriver, "mainDriver");
  const usage = need(journey.usage, "usage");
  const claims = need(journey.claims, "claims");
  const named = need(journey.namedDrivers, "namedDrivers");
  const drivers = named.any ? named.drivers : [];

  // Every driver's claims count (decision 5); a "No" ignores anything left from an earlier "Yes"
  const pastClaims =
    (claims.any ? claims.incidents.length : 0) +
    drivers.reduce((sum, d) => sum + (d.anyClaims ? d.pastClaims : 0), 0);

  return {
    vehicle: car,
    driver: {
      age: ageOn(main.dateOfBirth, today),
      licenceYears: wholeYearsBetween(need(main.licenceDate, "licenceDate"), today),
      occupation: main.occupation,
      noClaimsYears: need(main.noClaimsYears, "noClaimsYears"),
    },
    namedDrivers: drivers.map((d) => ({
      age: ageOn(d.dateOfBirth, today),
      licenceYears: wholeYearsBetween(d.licenceDate, today),
    })),
    pastClaims,
    postcodeArea: /^[A-Z]{1,2}/.exec(journey.postcode.trim().toUpperCase())![0],
    annualMileage: usage.annualMileage,
    usage: usage.usage,
    overnightLocation: usage.overnight,
    voluntaryExcessPence: 0,
  };
}
