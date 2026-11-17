import { describe, expect, it } from "vite-plus/test";

import { completeHomeJourney } from "#/features/quote/journey-fixtures";

import { homeDetailsFromJourney } from "./home-details";

// 5.7, decision 9: the home journey as the rows a saved quote keeps, every answer included

describe("homeDetailsFromJourney", () => {
  it("keeps the insured address and every answer", () => {
    expect(homeDetailsFromJourney(completeHomeJourney())).toEqual({
      product: "home",
      property: {
        addressLine1: "18 Albion Road",
        addressLine2: null,
        town: "Hackney",
        postcode: "E8 3RL",
        propertyType: "terraced",
        yearBuilt: 1985,
        bedrooms: 3,
        rebuildCostPence: 25_000_000,
        contentsValuePence: 5_000_000,
        valuablesPence: 500_000,
        hasAlarm: true,
        hasSmokeAlarm: true,
        lockType: "five_lever",
        windowLocks: "all_accessible",
        alarmType: "installed_unmonitored",
        pastClaims: 1,
      },
      priorClaims: [
        {
          occurredOn: "2024-03-12",
          type: "escape_of_water",
          amountPence: 95_000,
          status: "settled",
          fault: null,
        },
      ],
    });
  });

  it("saves no claims for a No, whatever was left from a Yes", () => {
    const journey = completeHomeJourney();
    journey.homeClaims!.any = false;
    const details = homeDetailsFromJourney(journey);
    expect(details.priorClaims).toEqual([]);
    expect(details.property.pastClaims).toBe(0);
  });

  it("normalises the postcode", () => {
    expect(
      homeDetailsFromJourney({ ...completeHomeJourney(), postcode: "e83rl" }).property.postcode,
    ).toBe("E8 3RL");
  });
});
