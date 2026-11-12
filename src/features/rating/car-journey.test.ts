import { describe, expect, it } from "vite-plus/test";

import { completeJourney, FIXTURE_TODAY } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";

import { carInputsFromJourney } from "./car-journey";

const golf = { year: 2021, insuranceGroup: 14, fuelType: "petrol", valuePence: 2_400_000 };

type Named = NonNullable<Journey["namedDrivers"]>["drivers"][number];
const named = (overrides: Partial<Named>): Named => ({
  ...completeJourney().namedDrivers!.drivers[0]!,
  ...overrides,
});

function withDrivers(drivers: Named[], journey = completeJourney()): Journey {
  return { ...journey, namedDrivers: { any: drivers.length > 0, drivers } };
}

describe("carInputsFromJourney", () => {
  it("maps the fixture journey", () => {
    // Alex: born 1991-05-12 → 35 on 2026-11-11; licence 2010-07-18 → 16 whole years
    // Jamie: born 1991-09-24 → 35; licence 2010-07-18 → 16; one incident, Jamie has none
    expect(carInputsFromJourney(completeJourney(), golf, FIXTURE_TODAY)).toEqual({
      vehicle: golf,
      driver: { age: 35, licenceYears: 16, occupation: "plumber", noClaimsYears: 5 },
      namedDrivers: [{ age: 35, licenceYears: 16 }],
      pastClaims: 1,
      postcodeArea: "E",
      annualMileage: 8_000,
      usage: "commuting",
      overnightLocation: "driveway",
      voluntaryExcessPence: 0,
    });
  });

  it("counts an age on the birthday, not the day before", () => {
    const journey = withDrivers([named({ dateOfBirth: "2007-11-12", licenceDate: "2025-01-10" })]);
    expect(carInputsFromJourney(journey, golf, "2026-11-11").namedDrivers[0]!.age).toBe(18);
    expect(carInputsFromJourney(journey, golf, "2026-11-12").namedDrivers[0]!.age).toBe(19);
  });

  it("counts licence years in whole years", () => {
    // 2025-01-10 to 2026-11-11 is 1 whole year; to 2027-01-10 is 2
    const journey = withDrivers([named({ licenceDate: "2025-01-10" })]);
    expect(carInputsFromJourney(journey, golf, "2026-11-11").namedDrivers[0]!.licenceYears).toBe(1);
    expect(carInputsFromJourney(journey, golf, "2027-01-10").namedDrivers[0]!.licenceYears).toBe(2);
  });

  it("adds every driver's claims", () => {
    // Alex's two incidents + Jamie's 1 claim = 3
    const journey = withDrivers([named({ anyClaims: true, pastClaims: 1 })]);
    journey.claims = {
      ...journey.claims!,
      incidents: [journey.claims!.incidents[0]!, { ...journey.claims!.incidents[0]!, id: "i2" }],
    };
    expect(carInputsFromJourney(journey, golf, FIXTURE_TODAY).pastClaims).toBe(3);
  });

  it("ignores a named driver's stale claims count when they said no", () => {
    // Review Focus 2: anyClaims false with a leftover 4 adds nothing; Alex's 1 incident stays
    const journey = withDrivers([named({ anyClaims: false, pastClaims: 4 })]);
    expect(carInputsFromJourney(journey, golf, FIXTURE_TODAY).pastClaims).toBe(1);
  });

  it("ignores incidents left behind when the main driver said no", () => {
    const journey = completeJourney();
    journey.claims = { ...journey.claims!, any: false };
    expect(carInputsFromJourney(journey, golf, FIXTURE_TODAY).pastClaims).toBe(0);
  });

  it("keeps named drivers in the order entered", () => {
    const journey = withDrivers([
      named({ id: "a", dateOfBirth: "1980-01-01" }),
      named({ id: "b", dateOfBirth: "2000-01-01", licenceDate: "2019-01-01" }),
    ]);
    expect(
      carInputsFromJourney(journey, golf, FIXTURE_TODAY).namedDrivers.map((d) => d.age),
    ).toEqual([46, 26]);
  });

  it("has no named drivers when the answer is no", () => {
    const journey = completeJourney();
    journey.namedDrivers = { ...journey.namedDrivers!, any: false };
    expect(carInputsFromJourney(journey, golf, FIXTURE_TODAY).namedDrivers).toEqual([]);
  });

  it("takes the area from the postcode's outward code", () => {
    const journey = { ...completeJourney(), postcode: "SW1A 1AA" };
    expect(carInputsFromJourney(journey, golf, FIXTURE_TODAY).postcodeArea).toBe("SW");
  });

  it("throws on a missing part", () => {
    const { usage: _usage, ...journey } = completeJourney();
    expect(() => carInputsFromJourney(journey, golf, FIXTURE_TODAY)).toThrow("usage");
  });
});
