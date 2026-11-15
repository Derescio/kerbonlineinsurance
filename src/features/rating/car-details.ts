import type { Journey } from "#/features/quote/journey-store";
import { wholeYearsBetween } from "#/features/quote/schemas/dates";
import type { CarDetails } from "#/server/data/quote-rows";

import type { RatedCar } from "./car-journey";

// The car journey as the rows a saved quote keeps (5.6, decision 5): the vehicle from the
// catalogue row it was priced from, and the drivers as entered. The caller has already checked the
// journey, as for carInputsFromJourney; a missing part is a bug, so it throws.

export type DetailedCar = RatedCar & {
  id: string;
  make: string;
  model: string;
  variant: string;
  doors: number;
};

function need<T>(value: T | undefined, part: string): T {
  if (value === undefined) throw new Error(`carDetailsFromJourney: no ${part}`);
  return value;
}

export function carDetailsFromJourney(
  journey: Journey,
  car: DetailedCar,
  today: string,
): CarDetails {
  const main = need(journey.mainDriver, "mainDriver");
  const usage = need(journey.usage, "usage");
  const claims = need(journey.claims, "claims");
  const named = need(journey.namedDrivers, "namedDrivers");

  return {
    product: "car",
    vehicle: {
      make: car.make,
      model: car.model,
      year: car.year,
      variant: car.variant,
      fuelType: car.fuelType,
      doors: car.doors,
      insuranceGroup: car.insuranceGroup,
      valuePence: car.valuePence,
      catalogueVariantId: car.id,
      registration: journey.vehicle?.demoPlate ?? null,
      currentMileage: usage.currentMileage,
      annualMileage: usage.annualMileage,
      usage: usage.usage,
      overnightLocation: usage.overnight,
    },
    drivers: [
      {
        firstName: main.firstName,
        lastName: main.lastName,
        dateOfBirth: main.dateOfBirth,
        occupation: main.occupation,
        licenceYears: wholeYearsBetween(need(main.licenceDate, "licenceDate"), today),
        noClaimsYears: need(main.noClaimsYears, "noClaimsYears"),
        // A "No" ignores anything left from an earlier "Yes", as the price does
        pastClaims: claims.any ? claims.incidents.length : 0,
      },
      // Named drivers have no no-claims years of their own on this policy
      ...(named.any ? named.drivers : []).map((d) => ({
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth,
        occupation: d.occupation,
        licenceYears: wholeYearsBetween(d.licenceDate, today),
        noClaimsYears: 0,
        pastClaims: d.anyClaims ? d.pastClaims : 0,
      })),
    ],
  };
}
