import { describe, expect, it } from "vite-plus/test";

import {
  firstIncompleteHomeStep,
  homeStepState,
  homeTabStates,
  storedHomeAnswers,
  storedHomeErrors,
} from "./home-steps";
import { completeHomeJourney, FIXTURE_TODAY } from "./journey-fixtures";
import type { Journey } from "./journey-store";

// 5.7, decision 2: a home step is complete only if its stored answers still pass against today,
// as car's are (5.3, call 16)

function without(...keys: (keyof Journey)[]): Journey {
  const journey = completeHomeJourney();
  for (const key of keys) delete journey[key];
  return journey;
}

describe("firstIncompleteHomeStep", () => {
  it("starts an empty journey at About you", () => {
    expect(firstIncompleteHomeStep(null, FIXTURE_TODAY)).toBe("about");
    expect(
      firstIncompleteHomeStep(
        without("homeAbout", "property", "contents", "homeClaims"),
        FIXTURE_TODAY,
      ),
    ).toBe("about");
  });

  it("finds the first step without valid answers, in order", () => {
    expect(firstIncompleteHomeStep(without("homeClaims"), FIXTURE_TODAY)).toBe("claims");
    expect(firstIncompleteHomeStep(without("property", "homeClaims"), FIXTURE_TODAY)).toBe(
      "property",
    );
    expect(firstIncompleteHomeStep(completeHomeJourney(), FIXTURE_TODAY)).toBeNull();
  });

  it("reopens Property for an address the postcode change dropped", () => {
    const journey = completeHomeJourney();
    const { address: _a, ...rest } = journey.property!;
    expect(firstIncompleteHomeStep({ ...journey, property: rest as never }, FIXTURE_TODAY)).toBe(
      "property",
    );
  });
});

describe("homeStepState", () => {
  it("reopens Claims when a claim leaves the 5-year window overnight", () => {
    const journey = completeHomeJourney();
    journey.homeClaims!.claims[0]!.date = "2021-11-17";
    expect(homeStepState(journey, "2026-11-16").claims).toBe(true);
    expect(homeStepState(journey, "2026-11-18").claims).toBe(false);
    expect(storedHomeErrors(journey, "claims", "2026-11-18")).toEqual({
      "claims.0.date": "The incident must be in the last 5 years.",
    });
  });

  it("gives each step's stored answers", () => {
    const journey = completeHomeJourney();
    expect(storedHomeAnswers(journey, "contents")).toEqual(journey.contents);
    expect(storedHomeAnswers(without("property"), "property")).toBeUndefined();
  });
});

describe("homeTabStates", () => {
  it("ticks complete steps, opens the first unfinished one and locks the rest", () => {
    expect(homeTabStates(without("contents", "homeClaims"), "about", FIXTURE_TODAY)).toEqual({
      about: "current",
      property: "done",
      contents: "open",
      claims: "locked",
    });
  });
});
