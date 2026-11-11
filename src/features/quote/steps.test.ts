import { describe, expect, it } from "vite-plus/test";

import { completeJourney, FIXTURE_TODAY } from "./journey-fixtures";
import type { Journey } from "./journey-store";
import { firstIncompleteStep, stepState } from "./steps";

// 5.3, call 16: a step is complete only if its answers still pass against today and the other parts

function without(...keys: (keyof Journey)[]): Journey {
  const journey = completeJourney();
  for (const key of keys) delete journey[key];
  return journey;
}

describe("firstIncompleteStep", () => {
  it("sends a journey without a car to the car step", () => {
    expect(firstIncompleteStep(null, FIXTURE_TODAY)).toBe("car");
    expect(firstIncompleteStep(without("vehicle"), FIXTURE_TODAY)).toBe("car");
  });

  it("finds the first step without valid answers, in order", () => {
    expect(
      firstIncompleteStep(without("mainDriver", "usage", "claims", "namedDrivers"), FIXTURE_TODAY),
    ).toBe("about");
    expect(firstIncompleteStep(without("namedDrivers"), FIXTURE_TODAY)).toBe("drivers");
    expect(firstIncompleteStep(without("usage"), FIXTURE_TODAY)).toBe("driving");
    expect(firstIncompleteStep(completeJourney(), FIXTURE_TODAY)).toBeNull();
  });
});

describe("stepState", () => {
  it("marks every step of a complete journey complete", () => {
    expect(stepState(completeJourney(), FIXTURE_TODAY)).toEqual({
      about: true,
      driving: true,
      claims: true,
      drivers: true,
    });
  });

  it("reopens claims when an incident falls out of the 5-year window overnight", () => {
    const journey = completeJourney();
    journey.claims!.incidents[0]!.date = "2021-11-11";
    expect(stepState(journey, "2026-11-11").claims).toBe(true);
    expect(stepState(journey, "2026-11-12").claims).toBe(false);
    expect(firstIncompleteStep(journey, "2026-11-12")).toBe("claims");
  });

  it("reopens the licence step when a new date of birth puts the licence before 17", () => {
    const journey = completeJourney();
    journey.mainDriver!.dateOfBirth = "1995-01-01";
    expect(stepState(journey, FIXTURE_TODAY)).toMatchObject({ about: true, driving: false });
  });

  it("isn't complete for a licence step with no licence answers yet", () => {
    const journey = completeJourney();
    delete journey.mainDriver!.licenceDate;
    expect(stepState(journey, FIXTURE_TODAY).driving).toBe(false);
  });
});
