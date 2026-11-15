import { describe, expect, it } from "vite-plus/test";

import { completeJourney, FIXTURE_TODAY } from "#/features/quote/journey-fixtures";

import { carDetailsFromJourney } from "./car-details";

// The car journey as the rows a saved quote keeps (5.6, decision 5)

const car = {
  id: "0195a000-0000-7000-8000-000000000001",
  make: "Volkswagen",
  model: "Golf",
  year: 2021,
  variant: "1.0 TSI Life 5dr",
  fuelType: "petrol",
  doors: 5,
  insuranceGroup: 14,
  valuePence: 2_400_000,
};

describe("carDetailsFromJourney", () => {
  it("maps the fixture journey", () => {
    // Alex: licence 2010-07-18 → 16 whole years on 2026-11-11, one incident; Jamie: no claims
    expect(carDetailsFromJourney(completeJourney(), car, FIXTURE_TODAY)).toEqual({
      product: "car",
      vehicle: {
        make: "Volkswagen",
        model: "Golf",
        year: 2021,
        variant: "1.0 TSI Life 5dr",
        fuelType: "petrol",
        doors: 5,
        insuranceGroup: 14,
        valuePence: 2_400_000,
        catalogueVariantId: "0195a000-0000-7000-8000-000000000001",
        registration: null,
        currentMileage: 18_200,
        annualMileage: 8_000,
        usage: "commuting",
        overnightLocation: "driveway",
      },
      drivers: [
        {
          firstName: "Alex",
          lastName: "Morgan",
          dateOfBirth: "1991-05-12",
          occupation: "plumber",
          licenceYears: 16,
          noClaimsYears: 5,
          pastClaims: 1,
        },
        {
          firstName: "Jamie",
          lastName: "Morgan",
          dateOfBirth: "1991-09-24",
          occupation: "teacher",
          licenceYears: 16,
          noClaimsYears: 0,
          pastClaims: 0,
        },
      ],
    });
  });

  it("stores 0 claims for a 'No', whatever an earlier 'Yes' left behind", () => {
    const journey = completeJourney();
    journey.claims = { ...journey.claims!, any: false };
    const jamie = journey.namedDrivers!.drivers[0]!;
    journey.namedDrivers!.drivers = [
      { ...jamie, anyClaims: false, pastClaims: 2 },
      { ...jamie, id: "d2", firstName: "Sam", anyClaims: true, pastClaims: 2 },
    ];
    const details = carDetailsFromJourney(journey, car, FIXTURE_TODAY);
    expect(details.drivers.map((d) => d.pastClaims)).toEqual([0, 0, 2]);
  });

  it("keeps the demo plate that found the car as its registration", () => {
    const journey = completeJourney();
    journey.vehicle = { ...journey.vehicle!, demoPlate: "VW21 GQL" };
    expect(carDetailsFromJourney(journey, car, FIXTURE_TODAY).vehicle.registration).toBe(
      "VW21 GQL",
    );
  });
});
