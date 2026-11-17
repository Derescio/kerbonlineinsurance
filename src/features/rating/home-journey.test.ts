import { describe, expect, it } from "vite-plus/test";

import { completeHomeJourney } from "#/features/quote/journey-fixtures";

import { homeInputsFromJourney } from "./home-journey";

// 5.7, decision 7: the home journey's answers as rating inputs. Pounds become pence; the price
// reads only "any alarm" and the number of claims.

describe("homeInputsFromJourney", () => {
  it("rates the answers, in pence", () => {
    expect(homeInputsFromJourney(completeHomeJourney())).toEqual({
      postcodeArea: "E",
      propertyType: "terraced",
      yearBuilt: 1985,
      bedrooms: 3,
      rebuildCostPence: 25_000_000,
      contentsValuePence: 5_000_000,
      hasAlarm: true,
      hasSmokeAlarm: true,
      lockType: "five_lever",
      pastClaims: 1,
    });
  });

  it("counts no alarm as none, and a No as no claims", () => {
    const journey = completeHomeJourney();
    journey.contents!.alarm = "none";
    journey.homeClaims!.any = false;
    const inputs = homeInputsFromJourney(journey);
    expect(inputs.hasAlarm).toBe(false);
    expect(inputs.pastClaims).toBe(0);
  });

  it("reads a two-letter area", () => {
    expect(
      homeInputsFromJourney({ ...completeHomeJourney(), postcode: "ls6 2ab" }).postcodeArea,
    ).toBe("LS");
  });
});
