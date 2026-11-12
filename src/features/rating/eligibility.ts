import type { ReasonCode } from "#/server/db/schema/values";
import { CROWN_DEPENDENCIES } from "#/server/reference/postcode-areas";

import type { Tables } from "./tables";
import type { BusinessInputs, CarDriver, CarInputs, HomeInputs } from "./types";

// Eligibility (5.4, spec decisions 8 and 14): pure functions beside the raters. The rule types are
// here; the numbers are the version's parameters (4.8 call 17). Declines come before referrals and
// the first rule hit wins. They never read a sensitive characteristic: the inputs have none.

export type Eligibility = {
  outcome: "referred" | "declined";
  reason: ReasonCode;
  /** "main", a named driver's 1-based position, or null when the rule isn't about a driver */
  driver: "main" | number | null;
} | null;

const refer = (reason: ReasonCode, driver: "main" | number | null = null): Eligibility => ({
  outcome: "referred",
  reason,
  driver,
});
const decline = (reason: ReasonCode, driver: "main" | number | null = null): Eligibility => ({
  outcome: "declined",
  reason,
  driver,
});

/** Jersey, Guernsey and the Isle of Man are separate insurance markets (4.8 call 6) */
export function coverAreaEligibility(postcodeArea: string): Eligibility {
  return (CROWN_DEPENDENCIES as readonly string[]).includes(postcodeArea)
    ? decline("outside_cover_area")
    : null;
}

/** The main driver, then each named driver in the order entered */
function firstDriver(i: CarInputs, test: (d: CarDriver) => boolean): "main" | number | null {
  if (test(i.driver)) return "main";
  const index = i.namedDrivers.findIndex(test);
  return index === -1 ? null : index + 1;
}

export function carEligibility(t: Tables, i: CarInputs): Eligibility {
  const group = i.vehicle.insuranceGroup;
  const value = i.vehicle.valuePence;

  if (value >= t.param("decline_value_pence_min")) return decline("vehicle_value_too_high");
  const young = firstDriver(
    i,
    (d) =>
      (d.age <= t.param("decline_young_age_max") && group >= t.param("decline_young_group_min")) ||
      (d.age < 25 && group >= t.param("decline_under25_group_min")),
  );
  if (young !== null) return decline("young_driver_high_group", young);

  if (group >= t.param("refer_insurance_group_min")) return refer("high_insurance_group");
  if (value >= t.param("refer_value_pence_min")) return refer("high_vehicle_value");
  if (i.pastClaims >= t.param("refer_past_claims_min")) return refer("past_claims");
  const newLicence = firstDriver(
    i,
    (d) =>
      d.licenceYears <= t.param("refer_new_licence_years_max") &&
      group >= t.param("refer_new_licence_group_min"),
  );
  if (newLicence !== null) return refer("new_licence_high_group", newLicence);
  const old = firstDriver(i, (d) => d.age >= t.param("refer_age_min"));
  if (old !== null) return refer("driver_age", old);
  return null;
}

export function homeEligibility(t: Tables, i: HomeInputs): Eligibility {
  if (i.rebuildCostPence >= t.param("decline_rebuild_pence_min")) {
    return decline("rebuild_cost_too_high");
  }
  if (i.rebuildCostPence >= t.param("refer_rebuild_pence_min")) return refer("high_rebuild_cost");
  if (i.contentsValuePence >= t.param("refer_contents_pence_min")) {
    return refer("high_contents_value");
  }
  if (i.yearBuilt <= t.param("refer_year_built_max")) return refer("old_property");
  if (i.pastClaims >= t.param("refer_past_claims_min")) return refer("past_claims");
  return null;
}

export function businessEligibility(t: Tables, i: BusinessInputs): Eligibility {
  const trade = t.lookup("trade", "trade_band", i.tradeClass, "trade");
  if (i.turnoverPence >= t.param("refer_turnover_pence_min")) return refer("high_turnover");
  if (i.employees >= t.param("refer_employees_min")) return refer("many_employees");
  if (trade.band === "E" && i.employees >= t.param("refer_high_risk_employees_min")) {
    return refer("high_risk_employees");
  }
  return null;
}
