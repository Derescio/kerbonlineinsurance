import { coverLevels } from "#/server/db/schema/values";

import { storedMonthly } from "./money";
import type { Tables } from "./tables";
import type {
  BusinessInputs,
  CarInputs,
  HomeInputs,
  PricedAddon,
  PricedFactor,
  PricedOption,
  Rated,
} from "./types";

// The per-product formulas (4.8, "Formula, for 5.4"). Eligibility is separate (eligibility.ts).

// The model year that counts as age 0: 4.8's valuation date (call 7)
const VALUATION_YEAR = 2026;

const product = (factors: readonly PricedFactor[]) =>
  factors.reduce((total, f) => total * f.multiplier, 1);

export function rateCar(t: Tables, i: CarInputs): Rated {
  const { vehicle, driver } = i;
  const occupation = t.lookup("occupation", "occupation_band", driver.occupation, "occupation");
  const area = t.lookup("postcode_area", "postcode_band", i.postcodeArea, "postcode area");
  // One named_driver_age row per item (quote_item_factors): the youngest is the riskiest
  const youngest = i.namedDrivers.reduce<number | null>(
    (min, d) => (min === null || d.age < min ? d.age : min),
    null,
  );
  const factors = [
    t.range("driver_age", driver.age),
    t.range("no_claims_years", driver.noClaimsYears),
    t.range("licence_years", driver.licenceYears),
    t.range("insurance_group", vehicle.insuranceGroup),
    t.range("annual_mileage", i.annualMileage),
    t.choice("usage", i.usage),
    t.choice("overnight_location", i.overnightLocation),
    t.choice("fuel_type", vehicle.fuelType),
    t.range("vehicle_age", Math.max(0, VALUATION_YEAR - vehicle.year)),
    t.range("past_claims", i.pastClaims),
    t.range("voluntary_excess", i.voluntaryExcessPence),
    ...(youngest === null ? [] : [t.range("named_driver_age", youngest)]),
    t.choice("occupation_band", occupation.band),
    t.choice("postcode_band", area.band),
  ];
  const anyUnder25 = [driver, ...i.namedDrivers].some((d) => d.age < 25);

  return {
    base: t.param("base_rate_pence") * product(factors),
    factors,
    extraExcessPence: anyUnder25 ? t.param("young_driver_excess_pence") : 0,
    addons: addons(t, []),
  };
}

export function rateHome(t: Tables, i: HomeInputs): Rated {
  const buildingsArea = t.lookup(
    "postcode_area",
    "buildings_postcode_band",
    i.postcodeArea,
    "postcode area",
  );
  const contentsArea = t.lookup(
    "postcode_area",
    "contents_postcode_band",
    i.postcodeArea,
    "postcode area",
  );
  const buildings = [
    t.choice("property_type", i.propertyType),
    t.range("year_built", i.yearBuilt),
    t.choice("buildings_postcode_band", buildingsArea.band),
  ];
  const contents = [
    t.choice("contents_postcode_band", contentsArea.band),
    t.choice("burglar_alarm", i.hasAlarm ? "yes" : "no"),
    t.choice("lock_type", i.lockType),
    t.choice("smoke_alarm", i.hasSmokeAlarm ? "yes" : "no"),
    t.range("bedrooms", i.bedrooms),
  ];
  const both = t.range("past_claims", i.pastClaims);

  const buildingsSection =
    (i.rebuildCostPence / 100_000) * t.param("buildings_rate_pence") * product(buildings);
  const contentsSection =
    (i.contentsValuePence / 100_000) * t.param("contents_rate_pence") * product(contents);

  return {
    base: (buildingsSection + contentsSection) * both.multiplier,
    factors: [...buildings, ...contents, both],
    extraExcessPence: 0,
    addons: addons(t, []),
  };
}

export function rateBusiness(t: Tables, i: BusinessInputs): Rated {
  const trade = t.lookup("trade", "trade_band", i.tradeClass, "trade");
  const area = t.lookup("postcode_area", "postcode_band", i.postcodeArea, "postcode area");
  const band = trade.band.toLowerCase();
  const turnover = t.range("turnover_band", i.turnoverPence);
  const postcode = t.choice("postcode_band", area.band);
  const factors = [t.choice("trade_band", trade.band), turnover, postcode];

  const publicLiability =
    t.param(`pl_rate_pence_${band}`) * turnover.multiplier * postcode.multiplier;
  const employersLiability = i.employees * t.param(`el_rate_pence_${band}`);

  return {
    base: publicLiability + employersLiability,
    factors,
    extraExcessPence: 0,
    addons: addons(t, factors, trade.group),
  };
}

/** Add-ons available to this risk, each priced by its listed factors (business only lists any) */
function addons(t: Tables, factors: readonly PricedFactor[], group?: string | null): PricedAddon[] {
  const rate = t.param("monthly_credit_charge_rate");
  return t.data.addons
    .filter(
      (a) => a.availableToGroups === null || (group != null && a.availableToGroups.includes(group)),
    )
    .map((a) => {
      const multiplier = a.factors.reduce((total, name) => {
        const f = factors.find((x) => x.factor === name);
        if (!f) throw new Error(`${t.data.product}: add-on ${a.addon} needs factor ${name}`);
        return total * f.multiplier;
      }, 1);
      const annual = Math.round(a.annualPricePence * multiplier);
      return {
        addon: a.addon,
        annualPricePence: annual,
        monthlyPricePence: storedMonthly(annual, rate),
      };
    });
}

/** Every cover tier, each rounded once and raised to the version's minimum */
export function priceOptions(t: Tables, rated: Rated): PricedOption[] {
  const min = t.param("min_premium_pence");
  const rate = t.param("monthly_credit_charge_rate");
  return coverLevels.map((coverLevel) => {
    const tier = t.data.tiers.find((x) => x.coverLevel === coverLevel);
    if (!tier) throw new Error(`${t.data.product}: no tier ${coverLevel}`);
    const annual = Math.max(min, Math.round(rated.base * tier.multiplier));
    return {
      coverLevel,
      coverMultiplier: tier.multiplier,
      compulsoryExcessPence: tier.compulsoryExcessPence + rated.extraExcessPence,
      annualPremiumPence: annual,
      monthlyPremiumPence: storedMonthly(annual, rate),
    };
  });
}
