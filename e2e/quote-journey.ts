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
    // Replaced with the Golf's real id: the price (5.4) is worked out from the catalogue
    catalogueVariantId: "",
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

interface CatalogueCar {
  id: string;
  make: string;
  model: string;
  year: number;
  variant: string;
}

/** The Tesla (group 32) with a 19-year-old named driver: declined, naming him (5.4, decision 14) */
const tesla = {
  make: "Tesla",
  model: "Model 3",
  year: 2024,
  variant: "RWD",
  fuelType: "electric",
  doors: 4,
};

function nineteenYearOld() {
  const dob = new Date();
  dob.setUTCFullYear(dob.getUTCFullYear() - 19);
  dob.setUTCMonth(0, 15);
  return {
    ...journey.namedDrivers.drivers[0],
    firstName: "Sam",
    dateOfBirth: dob.toISOString().slice(0, 10),
    licenceDate: `${dob.getUTCFullYear() + 17}-06-01`,
  };
}

/**
 * Puts the complete journey in sessionStorage before the page's own scripts run. `declined` swaps
 * in the Tesla and a 19-year-old named driver, so Your quote shows the review step (5.4b, R10).
 */
export async function withCompleteJourney(
  page: Page,
  { declined = false }: { declined?: boolean } = {},
): Promise<void> {
  const { cars } = (await (await page.request.get("/api/catalogue")).json()) as {
    cars: CatalogueCar[];
  };
  const v = declined ? { ...journey.vehicle, ...tesla } : journey.vehicle;
  const car = cars.find(
    (c) => c.make === v.make && c.model === v.model && c.year === v.year && c.variant === v.variant,
  );
  if (!car)
    throw new Error(`The ${v.year} ${v.make} ${v.model} ${v.variant} isn't in the catalogue`);
  const stored = {
    ...journey,
    vehicle: { ...v, catalogueVariantId: car.id },
    ...(declined && { namedDrivers: { any: true, drivers: [nineteenYearOld()] } }),
  };
  // Only into an empty tab: a reload keeps what the visitor has chosen since (5.5)
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("kerb.quote.v1.car"))
      sessionStorage.setItem("kerb.quote.v1.car", value);
  }, JSON.stringify(stored));
}
