import type { Page } from "@playwright/test";

// A complete car journey in the tab's sessionStorage (5.3), so axe can open each driver step
// directly: a cold link to a later step is sent back to the first unfinished one (call 5).
// The dates are far enough back to hold against any run date.
const journey = {
  version: 1,
  journeyId: "6b1d4c2e-8f3a-4b5c-9d7e-1f2a3b4c5d6e",
  postcode: "E8 3RL",
  startedAt: "2026-11-11T09:00:00.000Z",
  startRecorded: true,
  vehicle: {
    catalogueVariantId: "e2e-golf",
    make: "Volkswagen",
    model: "Golf",
    year: 2021,
    variant: "1.0 TSI Life 5dr",
    fuelType: "petrol",
    doors: 5,
  },
  mainDriver: {
    firstName: "Alex",
    lastName: "Morgan",
    dateOfBirth: "1991-05-12",
    status: "employed",
    occupation: "accountant",
    addressLine1: "18 Albion Road",
    town: "London",
    licenceType: "full_uk",
    licenceDate: "2010-07-18",
    noClaimsYears: 5,
  },
  usage: { annualMileage: 8000, currentMileage: 18200, usage: "commuting", overnight: "driveway" },
  claims: { any: false, incidents: [], confirmed: true },
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
        occupation: "accountant",
        licenceType: "full_uk",
        licenceDate: "2010-07-18",
        anyClaims: false,
        pastClaims: 0,
      },
    ],
  },
};

/** Puts the complete journey in sessionStorage before the page's own scripts run */
export async function withCompleteJourney(page: Page): Promise<void> {
  await page.addInitScript((value) => {
    sessionStorage.setItem("kerb.quote.v1.car", value);
  }, JSON.stringify(journey));
}
