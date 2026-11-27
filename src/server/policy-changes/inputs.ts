import type { HomeChange } from "#/features/policy-changes/request";
import { ageOn, wholeYearsBetween } from "#/features/quote/schemas/dates";
import type { CarInputs, HomeInputs } from "#/features/rating/types";
import type { CoverLevel } from "#/server/db/schema/values";

import type { ResolvedChange } from "./resolve";

// A car or home policy's rating inputs from its stored rows (6.3b, decision 4; home 6.3c), as carInputsFromJourney
// builds them from the journey: ages on the day it's priced, licence years as stored (a new
// driver's from their licence date), every driver's past claims, the postcode area of where the
// car is kept. With a change, the inputs as they'd be after it.

/** What every policy is priced with, whatever it insures */
export interface CommonRatingRows {
  coverLevel: CoverLevel;
  /** The selected add-ons */
  addons: string[];
  voluntaryExcessPence: number;
}

export interface PolicyRatingRows extends CommonRatingRows {
  /** The customer's postcode: the car is kept at their address */
  postcode: string;
  vehicle: {
    /** Null for a car entered by hand */
    catalogueVariantId: string | null;
    make: string;
    model: string;
    registration: string | null;
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
  change?: ResolvedChange,
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
  let vehicle = rows.vehicle;

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
    case "car_replaced":
      // The new car's rated fields from its catalogue row; mileage, use and parking carry over
      vehicle = {
        ...vehicle,
        year: change.car.year,
        insuranceGroup: change.car.insuranceGroup,
        fuelType: change.car.fuelType,
        valuePence: change.car.valuePence,
      };
      break;
  }

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

/** A home policy's properties row, as it's rated (6.3c, decision 4) */
export interface HomeRatingRows extends CommonRatingRows {
  property: {
    /** The insured home's: a home is rated where it is, not where its policyholder lives */
    postcode: string;
    propertyType: string;
    yearBuilt: number;
    bedrooms: number;
    rebuildCostPence: number;
    contentsValuePence: number;
    valuablesPence: number | null;
    hasAlarm: boolean;
    alarmType: string | null;
    windowLocks: string | null;
    hasSmokeAlarm: boolean;
    lockType: string;
    pastClaims: number;
    /** Null on a home bought before 5.7c, on home v1, which doesn't rate it */
    occupation: string | null;
  };
}

/**
 * A home policy's rating inputs from its stored row, as homeInputsFromJourney builds them from the
 * journey; with a change, as they'd be after it. Valuables, window locks and the kind of alarm
 * aren't rated, so only whether there is an alarm reaches the inputs.
 */
export function homeInputsFromPolicy(rows: HomeRatingRows, change?: HomeChange): HomeInputs {
  const { property } = rows;
  const inputs: HomeInputs = {
    postcodeArea: postcodeArea(property.postcode),
    propertyType: property.propertyType,
    yearBuilt: property.yearBuilt,
    bedrooms: property.bedrooms,
    rebuildCostPence: property.rebuildCostPence,
    contentsValuePence: property.contentsValuePence,
    hasAlarm: property.hasAlarm,
    hasSmokeAlarm: property.hasSmokeAlarm,
    lockType: property.lockType,
    pastClaims: property.pastClaims,
    occupation: property.occupation ?? "",
  };
  switch (change?.kind) {
    case "home_contents":
      return { ...inputs, contentsValuePence: change.contentsValuePence };
    case "home_security":
      return {
        ...inputs,
        lockType: change.lockType,
        hasAlarm: change.alarmType !== "none",
        hasSmokeAlarm: change.hasSmokeAlarm,
      };
    default:
      return inputs;
  }
}
