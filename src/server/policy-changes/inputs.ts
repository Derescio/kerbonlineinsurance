import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { ageOn, wholeYearsBetween } from "#/features/quote/schemas/dates";
import type { CarInputs } from "#/features/rating/types";
import type { CoverLevel } from "#/server/db/schema/values";

// A car policy's rating inputs from its stored rows (6.3b, decision 4), as carInputsFromJourney
// builds them from the journey: ages on the day it's priced, licence years as stored (a new
// driver's from their licence date), every driver's past claims, the postcode area of where the
// car is kept. With a change, the inputs as they'd be after it.

export interface PolicyRatingRows {
  /** The customer's postcode: the car is kept at their address */
  postcode: string;
  coverLevel: CoverLevel;
  /** The selected add-ons */
  addons: string[];
  voluntaryExcessPence: number;
  vehicle: {
    year: number;
    insuranceGroup: number;
    fuelType: string;
    valuePence: number;
    annualMileage: number;
    usage: string;
    overnightLocation: string;
  };
  /** Main driver first */
  drivers: {
    id: string;
    isMain: boolean;
    dateOfBirth: string;
    occupation: string;
    licenceYears: number;
    noClaimsYears: number;
    pastClaims: number;
  }[];
}

const postcodeArea = (postcode: string): string =>
  /^[A-Z]{1,2}/.exec(postcode.trim().toUpperCase())![0];

export function carInputsFromPolicy(
  rows: PolicyRatingRows,
  today: string,
  change?: PolicyChangeRequest,
): { inputs: CarInputs; coverLevel: CoverLevel; addons: string[] } {
  const main = rows.drivers.find((d) => d.isMain);
  if (!main) throw new Error("carInputsFromPolicy: no main driver");
  let named = rows.drivers
    .filter((d) => !d.isMain)
    .map((d) => ({
      id: d.id,
      dateOfBirth: d.dateOfBirth,
      licenceYears: d.licenceYears,
      pastClaims: d.pastClaims,
    }));
  let postcode = rows.postcode;
  let overnightLocation = rows.vehicle.overnightLocation;
  let coverLevel = rows.coverLevel;
  let addons = rows.addons;
  let voluntaryExcessPence = rows.voluntaryExcessPence;

  switch (change?.kind) {
    case "address":
      postcode = change.postcode;
      overnightLocation = change.overnightLocation;
      break;
    case "driver_added":
      named = [
        ...named,
        {
          id: "new",
          dateOfBirth: change.driver.dateOfBirth,
          licenceYears: wholeYearsBetween(change.driver.licenceDate, today),
          // Only a driver with no claims or convictions is added online
          pastClaims: 0,
        },
      ];
      break;
    case "driver_removed":
      named = named.filter((d) => d.id !== change.driverId);
      break;
    case "cover":
      coverLevel = change.coverLevel;
      addons = change.addons;
      voluntaryExcessPence = change.voluntaryExcessPence;
      break;
  }

  const { vehicle } = rows;
  return {
    inputs: {
      vehicle: {
        year: vehicle.year,
        insuranceGroup: vehicle.insuranceGroup,
        fuelType: vehicle.fuelType,
        valuePence: vehicle.valuePence,
      },
      driver: {
        age: ageOn(main.dateOfBirth, today),
        licenceYears: main.licenceYears,
        occupation: main.occupation,
        noClaimsYears: main.noClaimsYears,
      },
      namedDrivers: named.map((d) => ({
        age: ageOn(d.dateOfBirth, today),
        licenceYears: d.licenceYears,
      })),
      pastClaims: main.pastClaims + named.reduce((sum, d) => sum + d.pastClaims, 0),
      postcodeArea: postcodeArea(postcode),
      annualMileage: vehicle.annualMileage,
      usage: vehicle.usage,
      overnightLocation,
      voluntaryExcessPence,
    },
    coverLevel,
    addons,
  };
}
