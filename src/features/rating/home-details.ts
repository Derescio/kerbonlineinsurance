import type { Journey } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import type { HomeDetails } from "#/server/data/quote-rows";

import { homeInputsFromJourney } from "./home-journey";

// The home journey as the rows a saved quote keeps (5.7, decisions 9 and 10): the insured address,
// every answer, rated or not, and one prior claim per claim. The caller has already checked the
// journey; a missing part is a bug, so it throws.

export function homeDetailsFromJourney(journey: Journey): HomeDetails {
  const inputs = homeInputsFromJourney(journey);
  const address = journey.property?.address;
  if (!address) throw new Error("homeDetailsFromJourney: no address");
  const contents = journey.contents!;
  const claims = journey.homeClaims!;

  return {
    product: "home",
    property: {
      addressLine1: address.line1,
      addressLine2: address.line2 ?? null,
      town: address.town,
      postcode: normalisePostcode(journey.postcode) ?? journey.postcode,
      propertyType: inputs.propertyType,
      yearBuilt: inputs.yearBuilt,
      bedrooms: inputs.bedrooms,
      rebuildCostPence: inputs.rebuildCostPence,
      contentsValuePence: inputs.contentsValuePence,
      valuablesPence: contents.valuablesPounds * 100,
      hasAlarm: inputs.hasAlarm,
      hasSmokeAlarm: inputs.hasSmokeAlarm,
      lockType: inputs.lockType,
      windowLocks: contents.windowLocks,
      alarmType: contents.alarm,
      pastClaims: inputs.pastClaims,
    },
    priorClaims: (claims.any ? claims.claims : []).map((c) => ({
      occurredOn: c.date,
      type: c.type,
      amountPence: c.amountPounds * 100,
      status: c.status,
      fault: null,
    })),
  };
}
