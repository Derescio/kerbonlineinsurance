import type { Journey } from "#/features/quote/journey-store";

import type { HomeInputs } from "./types";

// The home journey's answers (5.7) as rating inputs (decision 7). The caller has already checked
// that every step passes; a missing part here is a bug, so it throws. Valuables, window locks, the
// kind of alarm and each claim's details are stored but not rated.

function need<T>(value: T | undefined, part: string): T {
  if (value === undefined) throw new Error(`homeInputsFromJourney: no ${part}`);
  return value;
}

export function homeInputsFromJourney(journey: Journey): HomeInputs {
  const property = need(journey.property, "property");
  const contents = need(journey.contents, "contents");
  const claims = need(journey.homeClaims, "homeClaims");
  return {
    postcodeArea: /^[A-Z]{1,2}/.exec(journey.postcode.trim().toUpperCase())![0],
    propertyType: property.propertyType,
    yearBuilt: property.yearBuilt,
    bedrooms: property.bedrooms,
    rebuildCostPence: property.rebuildCostPounds * 100,
    contentsValuePence: contents.contentsValuePounds * 100,
    hasAlarm: contents.alarm !== "none",
    hasSmokeAlarm: contents.smokeAlarm,
    lockType: contents.lockType,
    // A "No" ignores anything left from an earlier "Yes", as car's does
    pastClaims: claims.any ? claims.claims.length : 0,
  };
}
