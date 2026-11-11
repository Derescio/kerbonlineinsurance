import type { Journey, VehicleChoice } from "./journey-store";

// Test-only answers for the car journey (5.3): a complete journey on 11 Nov 2026, the frames'
// Alex Morgan in a 2021 Volkswagen Golf.

export const FIXTURE_TODAY = "2026-11-11";

export const golf: VehicleChoice = {
  catalogueVariantId: "golf-1",
  make: "Volkswagen",
  model: "Golf",
  year: 2021,
  variant: "1.0 TSI Life 5dr",
  fuelType: "petrol",
  doors: 5,
};

export function completeJourney(): Journey {
  return {
    version: 1,
    journeyId: "6b1d4c2e-8f3a-4b5c-9d7e-1f2a3b4c5d6e",
    postcode: "E8 3RL",
    startedAt: "2026-11-11T09:00:00.000Z",
    startRecorded: true,
    vehicle: golf,
    mainDriver: {
      firstName: "Alex",
      lastName: "Morgan",
      dateOfBirth: "1991-05-12",
      status: "employed",
      occupation: "plumber",
      addressLine1: "18 Albion Road",
      town: "London",
      licenceType: "full_uk",
      licenceDate: "2010-07-18",
      noClaimsYears: 5,
    },
    usage: {
      annualMileage: 8000,
      currentMileage: 18200,
      usage: "commuting",
      overnight: "driveway",
    },
    claims: {
      any: true,
      incidents: [
        {
          id: "i1",
          date: "2022-02-14",
          type: "collision",
          fault: "not_at_fault",
          costPounds: 1200,
        },
      ],
      confirmed: true,
    },
    namedDrivers: {
      any: true,
      drivers: [
        {
          id: "d1",
          firstName: "Jamie",
          lastName: "Morgan",
          dateOfBirth: "1991-09-24",
          relationship: "spouse",
          status: "employed",
          occupation: "teacher",
          licenceType: "full_uk",
          licenceDate: "2010-07-18",
          anyClaims: false,
          pastClaims: 0,
        },
      ],
    },
  };
}
