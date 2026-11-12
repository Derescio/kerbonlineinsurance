import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { vehicleCatalogue } from "#/server/db/schema";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";

import { priceCarJourney } from "./price";

// The car price on the server (5.4, spec decision 3): parsed and checked like the tab, priced from
// the active car version and the catalogue, 60 an hour per IP, and nothing of the tables sent back.

const from = (ip: string) => new Headers({ "x-forwarded-for": ip });
const IP = "203.0.113.9";
// The fixture's dates hold on 11 Nov 2026
const NOW = new Date("2026-11-11T12:00:00Z");

async function catalogueId(make: string, model: string, year: number, variant: string) {
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === make && r.model === model && r.year === year && r.variant === variant,
  );
  if (!row) throw new Error(`${make} ${model} not in the catalogue`);
  return row.id;
}

async function journeyIn(make: string, model: string, year: number, variant: string) {
  const journey = completeJourney();
  journey.vehicle = {
    ...journey.vehicle!,
    make,
    model,
    year,
    variant,
    catalogueVariantId: await catalogueId(make, model, year, variant),
  };
  return journey;
}

const golf = () => journeyIn("Volkswagen", "Golf", 2021, "1.0 TSI Life 5dr");
const tesla = () => journeyIn("Tesla", "Model 3", 2024, "RWD");

function withYoungNamedDriver(journey: Journey): Journey {
  const driver = journey.namedDrivers!.drivers[0]!;
  return {
    ...journey,
    namedDrivers: {
      any: true,
      drivers: [
        {
          ...driver,
          firstName: "Sam",
          dateOfBirth: "2007-05-01",
          relationship: "child",
          status: "student",
          occupation: "student",
          licenceDate: "2025-06-01",
        },
      ],
    },
  };
}

describe("priceCarJourney", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    await truncateAll();
    clearReferenceCaches();
    await upsertReferenceData(getOwnerDb(), {
      rating: structuredClone(RATING_SOURCES),
      catalogue: structuredClone(CATALOGUE_SOURCES),
    });
  });
  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The reference data is loaded once (beforeAll); each test clears only what it writes
    await truncateExcept(REFERENCE_TABLES);
    clearReferenceCaches();
  });
  afterEach(() => warn.mockRestore());
  afterAll(closeDb);

  it("prices the fixture journey in the Golf, Comprehensive with IPT", async () => {
    // Car v1 for Alex (35, plumber band C, E band 9, group 14, 1 claim) with Jamie (35) named:
    // 46000 × 1.06 (age 30-39) × 1.05 (NCD 5) × 1 (licence 5+) × 0.9785 (group 14) × 1 (8,000 miles)
    //   × 1 (commuting) × 0.97 (driveway) × 1 (petrol) × 1 (age 3-7) × 1.3 (1 claim) × 1 (no vol. excess)
    //   × 0.97 (named 30-74) × 1 (band C) × 1.55 (band 9) = 94980.04 → 94980
    // IPT round(94980 × 0.12) = 11398; total 106378; monthly round(106378 × 1.10 / 12) = 9751
    const result = await priceCarJourney(await golf(), from(IP), NOW, SECRET);
    expect(result).toEqual({ status: "quoted", annualPence: 106_378, monthlyPaymentPence: 9_751 });
  });

  it("sends nothing of the rating tables", async () => {
    const json = JSON.stringify(await priceCarJourney(await golf(), from(IP), NOW, SECRET));
    for (const key of ["factors", "parameters", "tiers", "lookups", "multiplier", "reason"]) {
      expect(json).not.toContain(key);
    }
  });

  it("declines the Tesla with a 19-year-old named driver, naming them, and quotes it without", async () => {
    // Tesla Model 3 RWD is group 32; under 21 on group 30+ is declined (car v1)
    await expect(
      priceCarJourney(withYoungNamedDriver(await tesla()), from(IP), NOW, SECRET),
    ).resolves.toEqual({ status: "declined", namedDriver: 1 });
    await expect(priceCarJourney(await tesla(), from(IP), NOW, SECRET)).resolves.toMatchObject({
      status: "quoted",
    });
  });

  it("names no driver when the rule is about the car or the claims", async () => {
    const journey = await golf();
    journey.claims!.incidents = [1, 2, 3].map((n) => ({
      ...journey.claims!.incidents[0]!,
      id: `i${n}`,
    }));
    await expect(priceCarJourney(journey, from(IP), NOW, SECRET)).resolves.toEqual({
      status: "referred",
      namedDriver: null,
    });
  });

  it("sends a step that no longer passes back to that step", async () => {
    // Review Focus 1: a licence date before the 17th birthday (Alex was born in 1991)
    const journey = await golf();
    journey.mainDriver!.licenceDate = "2005-01-01";
    await expect(priceCarJourney(journey, from(IP), NOW, SECRET)).resolves.toEqual({
      status: "invalid",
      step: "driving",
    });
  });

  it("sends an unknown or inactive car back to the car step", async () => {
    // Review Focus 4: an old tab holding a car the catalogue no longer lists
    const unknown = await golf();
    unknown.vehicle!.catalogueVariantId = "01950000-0000-7000-8000-000000000000";
    await expect(priceCarJourney(unknown, from(IP), NOW, SECRET)).resolves.toEqual({
      status: "invalid",
      step: "car",
    });

    const inactive = await golf();
    const golfRow = eq(vehicleCatalogue.id, inactive.vehicle!.catalogueVariantId);
    await getOwnerDb().update(vehicleCatalogue).set({ isActive: false }).where(golfRow);
    clearReferenceCaches();
    try {
      await expect(priceCarJourney(inactive, from(IP), NOW, SECRET)).resolves.toEqual({
        status: "invalid",
        step: "car",
      });
    } finally {
      // The catalogue is shared by the file's tests
      await getOwnerDb().update(vehicleCatalogue).set({ isActive: true }).where(golfRow);
    }
  });

  it("treats input that isn't a journey as the car step", async () => {
    await expect(priceCarJourney({ hello: "world" }, from(IP), NOW, SECRET)).resolves.toEqual({
      status: "invalid",
      step: "car",
    });
  });

  it("allows 60 prices an hour from one IP", async () => {
    for (let i = 0; i < 60; i++) {
      await expect(priceCarJourney(null, from(IP), NOW, SECRET)).resolves.toMatchObject({
        status: "invalid",
      });
    }
    await expect(priceCarJourney(null, from(IP), NOW, SECRET)).resolves.toEqual({
      status: "rate_limited",
    });
    // Another IP still gets through
    await expect(priceCarJourney(null, from("198.51.100.4"), NOW, SECRET)).resolves.toMatchObject({
      status: "invalid",
    });
  });
});
