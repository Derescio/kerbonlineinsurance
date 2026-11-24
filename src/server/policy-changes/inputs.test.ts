import { describe, expect, it } from "vite-plus/test";

import { completeJourney, FIXTURE_TODAY, golf } from "#/features/quote/journey-fixtures";
import { carDetailsFromJourney, type DetailedCar } from "#/features/rating/car-details";
import { carInputsFromJourney } from "#/features/rating/car-journey";

import { carInputsFromPolicy, type PolicyRatingRows } from "./inputs";

// A policy's rating inputs rebuilt from its stored rows (6.3b, decision 4). The rows here are
// what the quote save writes for the frames' journey (carDetailsFromJourney), so a policy that
// hasn't changed must rate exactly as its journey did.

const car: DetailedCar = {
  id: golf.catalogueVariantId!,
  make: golf.make,
  model: golf.model,
  variant: golf.variant,
  year: golf.year,
  doors: golf.doors,
  fuelType: golf.fuelType,
  insuranceGroup: 14,
  valuePence: 1_650_000,
};

function rowsFor(today = FIXTURE_TODAY): PolicyRatingRows {
  const journey = completeJourney();
  const details = carDetailsFromJourney(journey, car, today);
  return {
    postcode: journey.postcode,
    coverLevel: "comprehensive",
    addons: ["breakdown_uk"],
    voluntaryExcessPence: 25_000,
    vehicle: details.vehicle,
    drivers: details.drivers.map((d, i) => ({
      ...d,
      id: `driver-${i}`,
      isMain: i === 0,
      pastClaims: d.pastClaims ?? 0,
    })),
  };
}

describe("carInputsFromPolicy", () => {
  it("rates a stored policy exactly as its journey did", () => {
    const { year, insuranceGroup, fuelType, valuePence } = car;
    const rated = { year, insuranceGroup, fuelType, valuePence };
    const expected = carInputsFromJourney(completeJourney(), rated, FIXTURE_TODAY, 25_000);
    const { inputs, coverLevel, addons } = carInputsFromPolicy(rowsFor(), FIXTURE_TODAY);
    expect(inputs).toEqual(expected);
    expect(coverLevel).toBe("comprehensive");
    expect(addons).toEqual(["breakdown_uk"]);
  });

  it("works ages out on the day it's priced", () => {
    // A year on, each driver is a year older; licence years stay as stored
    const { inputs } = carInputsFromPolicy(rowsFor(), "2027-11-11");
    expect(inputs.driver.age).toBe(36);
    expect(inputs.namedDrivers[0]!.age).toBe(36);
    expect(inputs.driver.licenceYears).toBe(16);
  });

  it("adds a driver, with licence years from the licence date", () => {
    const { inputs } = carInputsFromPolicy(rowsFor(), FIXTURE_TODAY, {
      kind: "driver_added",
      driver: {
        firstName: "Arjun",
        lastName: "Patel",
        dateOfBirth: "1989-11-02",
        relationship: "partner",
        licenceType: "full_uk",
        licenceDate: "2015-06-01",
        occupation: "teacher",
        employmentStatus: "employed",
        noClaimsConfirmed: true,
      },
    });
    expect(inputs.namedDrivers).toEqual([
      { age: 35, licenceYears: 16 },
      { age: 37, licenceYears: 11 },
    ]);
    expect(inputs.pastClaims).toBe(1);
  });

  it("removes a driver, and their claims with them", () => {
    const rows = rowsFor();
    rows.drivers[1]!.pastClaims = 2;
    const { inputs } = carInputsFromPolicy(rows, FIXTURE_TODAY, {
      kind: "driver_removed",
      driverId: "driver-1",
    });
    expect(inputs.namedDrivers).toEqual([]);
    expect(inputs.pastClaims).toBe(1);
  });

  it("takes an address change's postcode area and overnight location", () => {
    const { inputs } = carInputsFromPolicy(rowsFor(), FIXTURE_TODAY, {
      kind: "address",
      postcode: "N16 7HB",
      addressLine1: "12 Albion Road",
      addressLine2: null,
      town: "London",
      overnightLocation: "street",
    });
    expect(inputs.postcodeArea).toBe("N");
    expect(inputs.overnightLocation).toBe("street");
  });

  it("carries a cover change's level, add-ons and voluntary excess", () => {
    const result = carInputsFromPolicy(rowsFor(), FIXTURE_TODAY, {
      kind: "cover",
      coverLevel: "plus",
      addons: ["courtesy_car"],
      voluntaryExcessPence: 50_000,
    });
    expect(result.coverLevel).toBe("plus");
    expect(result.addons).toEqual(["courtesy_car"]);
    expect(result.inputs.voluntaryExcessPence).toBe(50_000);
  });
});
