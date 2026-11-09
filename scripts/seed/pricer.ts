import { coverLevels, type CoverLevel } from "#/server/db/schema/values";
import type { RatingFactor, RatingSource } from "#/server/reference/rating/types";

// Stand-in for 5.4's priceQuote(); 5.4 replaces it and reseeds dev (4.9, call 9). It prices a seeded
// quote item from a rating version's tables using the formulas in 08-reference-data.md (Car, Home
// and Business v1): factors multiplied exactly, each tier rounded to whole pence once, raised to
// the minimum premium, IPT on the rounded premium. Eligibility reads the version's thresholds; the
// reason codes beyond the calibration ones are the seed's own until 5.4 fixes the list.

export interface CarInputs {
  vehicle: {
    make: string;
    model: string;
    year: number;
    variant: string;
    insuranceGroup: number;
    fuelType?: string;
    valuePence?: number;
  };
  driver: {
    age: number;
    occupation: string;
    licenceYears: number;
    noClaimsYears: number;
    pastClaims: number;
  };
  /** At most one in the seed: quote_item_factors holds one row per factor */
  namedDriver?: { age: number };
  postcodeArea: string;
  annualMileage: number;
  usage: string;
  overnightLocation: string;
  voluntaryExcessPence: number;
  coverLevel: CoverLevel;
}

export interface HomeInputs {
  postcodeArea: string;
  propertyType: string;
  yearBuilt: number;
  bedrooms: number;
  rebuildCostPence: number;
  contentsValuePence: number;
  hasAlarm: boolean;
  hasSmokeAlarm: boolean;
  lockType: string;
  pastClaims: number;
  coverLevel: CoverLevel;
}

export interface BusinessInputs {
  tradeClass: string;
  postcodeArea: string;
  turnoverPence: number;
  employees: number;
  coverLevel: CoverLevel;
  addons: string[];
}

export type PricingInputs =
  | { product: "car"; inputs: CarInputs }
  | { product: "home"; inputs: HomeInputs }
  | { product: "business"; inputs: BusinessInputs };

export interface PricedFactor {
  factor: string;
  inputValue: string;
  multiplier: number;
}

export interface PricedOption {
  coverLevel: CoverLevel;
  coverMultiplier: number;
  compulsoryExcessPence: number;
  /** Before IPT */
  annualPremiumPence: number;
  monthlyPremiumPence: number;
}

export interface PricedAddon {
  addon: string;
  annualPricePence: number;
  monthlyPricePence: number;
}

export interface PricedItem {
  outcome: "quoted" | "referred" | "declined";
  reasonCode: string | null;
  factors: PricedFactor[];
  options: PricedOption[];
  addons: PricedAddon[];
  iptRate: number;
}

/** IPT on a rounded premium, in whole pence */
export function ipt(pence: number, rate: number): number {
  return Math.round(pence * rate);
}

// The model year that counts as age 0: 4.8's valuation date (call 7)
const VALUATION_YEAR = 2026;

class Tables {
  constructor(readonly source: RatingSource) {}

  param(name: string): number {
    const value = this.source.parameters[name];
    if (value === undefined) throw new Error(`${this.source.product}: missing parameter ${name}`);
    return value;
  }

  private rows(factor: string): RatingFactor[] {
    const rows = this.source.factors.filter((f) => f.factor === factor);
    if (rows.length === 0) throw new Error(`${this.source.product}: no factor ${factor}`);
    return rows;
  }

  range(factor: string, value: number): PricedFactor {
    const row = this.rows(factor).find(
      (r) =>
        r.rangeFrom !== null && r.rangeFrom <= value && (r.rangeTo === null || value <= r.rangeTo),
    );
    if (!row) throw new Error(`${this.source.product}: ${factor} has no band for ${value}`);
    return { factor, inputValue: row.band, multiplier: row.multiplier };
  }

  choice(factor: string, band: string): PricedFactor {
    const row = this.rows(factor).find((r) => r.band === band);
    if (!row) throw new Error(`${this.source.product}: ${factor} has no band ${band}`);
    return { factor, inputValue: band, multiplier: row.multiplier };
  }

  /** A lookup key's band, e.g. occupation teacher → B; `label` names it in the error */
  lookup(kind: string, factor: string, key: string, label: string) {
    const row = this.source.lookups.find(
      (l) => l.lookup === kind && l.factor === factor && l.key === key,
    );
    if (!row) throw new Error(`${this.source.product}: unknown ${label}: ${key}`);
    return row;
  }
}

const product = (factors: readonly PricedFactor[]) =>
  factors.reduce((total, f) => total * f.multiplier, 1);

function monthly(annualPence: number, t: Tables): number {
  return Math.round((annualPence * (1 + t.param("monthly_credit_charge_rate"))) / 12);
}

interface Rated {
  /** Before the tier multiplier, unrounded */
  base: number;
  factors: PricedFactor[];
  /** Added to every tier's compulsory excess */
  extraExcessPence: number;
  /** The first rule hit, declines before referrals */
  eligibility: { outcome: "referred" | "declined"; reason: string } | null;
  addons: PricedAddon[];
}

function rateCar(t: Tables, i: CarInputs): Rated {
  const { vehicle, driver } = i;
  const occupation = t.lookup("occupation", "occupation_band", driver.occupation, "occupation");
  const area = t.lookup("postcode_area", "postcode_band", i.postcodeArea, "postcode area");
  const factors = [
    t.range("driver_age", driver.age),
    t.range("no_claims_years", driver.noClaimsYears),
    t.range("licence_years", driver.licenceYears),
    t.range("insurance_group", vehicle.insuranceGroup),
    t.range("annual_mileage", i.annualMileage),
    t.choice("usage", i.usage),
    t.choice("overnight_location", i.overnightLocation),
    t.choice("fuel_type", vehicle.fuelType ?? "petrol"),
    t.range("vehicle_age", Math.max(0, VALUATION_YEAR - vehicle.year)),
    t.range("past_claims", driver.pastClaims),
    t.range("voluntary_excess", i.voluntaryExcessPence),
    ...(i.namedDriver ? [t.range("named_driver_age", i.namedDriver.age)] : []),
    t.choice("occupation_band", occupation.band),
    t.choice("postcode_band", area.band),
  ];

  const group = vehicle.insuranceGroup;
  const value = vehicle.valuePence ?? 0;
  let eligibility: Rated["eligibility"] = null;
  if (value >= t.param("decline_value_pence_min")) {
    eligibility = { outcome: "declined", reason: "vehicle_value_too_high" };
  } else if (
    (driver.age <= t.param("decline_young_age_max") &&
      group >= t.param("decline_young_group_min")) ||
    (driver.age < 25 && group >= t.param("decline_under25_group_min"))
  ) {
    eligibility = { outcome: "declined", reason: "young_driver_high_group" };
  } else if (group >= t.param("refer_insurance_group_min")) {
    eligibility = { outcome: "referred", reason: "high_insurance_group" };
  } else if (value >= t.param("refer_value_pence_min")) {
    eligibility = { outcome: "referred", reason: "high_vehicle_value" };
  } else if (driver.pastClaims >= t.param("refer_past_claims_min")) {
    eligibility = { outcome: "referred", reason: "past_claims" };
  } else if (
    driver.licenceYears <= t.param("refer_new_licence_years_max") &&
    group >= t.param("refer_new_licence_group_min")
  ) {
    eligibility = { outcome: "referred", reason: "new_licence_high_group" };
  } else if (driver.age >= t.param("refer_age_min")) {
    eligibility = { outcome: "referred", reason: "driver_age" };
  }

  return {
    base: t.param("base_rate_pence") * product(factors),
    factors,
    extraExcessPence: driver.age < 25 ? t.param("young_driver_excess_pence") : 0,
    eligibility,
    addons: flatAddons(t, []),
  };
}

function rateHome(t: Tables, i: HomeInputs): Rated {
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

  let eligibility: Rated["eligibility"] = null;
  if (i.rebuildCostPence >= t.param("decline_rebuild_pence_min")) {
    eligibility = { outcome: "declined", reason: "rebuild_cost_too_high" };
  } else if (i.rebuildCostPence >= t.param("refer_rebuild_pence_min")) {
    eligibility = { outcome: "referred", reason: "high_rebuild_cost" };
  } else if (i.contentsValuePence >= t.param("refer_contents_pence_min")) {
    eligibility = { outcome: "referred", reason: "high_contents_value" };
  } else if (i.yearBuilt <= t.param("refer_year_built_max")) {
    eligibility = { outcome: "referred", reason: "old_property" };
  } else if (i.pastClaims >= t.param("refer_past_claims_min")) {
    eligibility = { outcome: "referred", reason: "past_claims" };
  }

  return {
    base: (buildingsSection + contentsSection) * both.multiplier,
    factors: [...buildings, ...contents, both],
    extraExcessPence: 0,
    eligibility,
    addons: flatAddons(t, []),
  };
}

function rateBusiness(t: Tables, i: BusinessInputs): Rated {
  const trade = t.lookup("trade", "trade_band", i.tradeClass, "trade");
  const area = t.lookup("postcode_area", "postcode_band", i.postcodeArea, "postcode area");
  const band = trade.band.toLowerCase();
  const turnover = t.range("turnover_band", i.turnoverPence);
  const postcode = t.choice("postcode_band", area.band);
  const factors = [t.choice("trade_band", trade.band), turnover, postcode];

  const publicLiability =
    t.param(`pl_rate_pence_${band}`) * turnover.multiplier * postcode.multiplier;
  const employersLiability = i.employees * t.param(`el_rate_pence_${band}`);

  let eligibility: Rated["eligibility"] = null;
  if (i.turnoverPence >= t.param("refer_turnover_pence_min")) {
    eligibility = { outcome: "referred", reason: "high_turnover" };
  } else if (i.employees >= t.param("refer_employees_min")) {
    eligibility = { outcome: "referred", reason: "many_employees" };
  } else if (trade.band === "E" && i.employees >= t.param("refer_high_risk_employees_min")) {
    eligibility = { outcome: "referred", reason: "high_risk_employees" };
  }

  return {
    base: publicLiability + employersLiability,
    factors,
    extraExcessPence: 0,
    eligibility,
    addons: flatAddons(t, factors, trade.group),
  };
}

/** Add-ons available to this risk, each priced by its listed factors (business only lists any) */
function flatAddons(
  t: Tables,
  factors: readonly PricedFactor[],
  group?: string | null,
): PricedAddon[] {
  return t.source.addons
    .filter(
      (a) => a.availableToGroups === null || (group != null && a.availableToGroups.includes(group)),
    )
    .map((a) => {
      const multiplier = a.factors.reduce((total, name) => {
        const f = factors.find((x) => x.factor === name);
        if (!f) throw new Error(`${t.source.product}: add-on ${a.addon} needs factor ${name}`);
        return total * f.multiplier;
      }, 1);
      const annual = Math.round(a.annualPricePence * multiplier);
      return { addon: a.addon, annualPricePence: annual, monthlyPricePence: monthly(annual, t) };
    });
}

export function priceItem(source: RatingSource, item: PricingInputs): PricedItem {
  const t = new Tables(source);
  const rated =
    item.product === "car"
      ? rateCar(t, item.inputs)
      : item.product === "home"
        ? rateHome(t, item.inputs)
        : rateBusiness(t, item.inputs);

  const min = t.param("min_premium_pence");
  const options = coverLevels.map((coverLevel) => {
    const tier = source.tiers.find((x) => x.coverLevel === coverLevel);
    if (!tier) throw new Error(`${source.product}: no tier ${coverLevel}`);
    const annual = Math.max(min, Math.round(rated.base * tier.multiplier));
    return {
      coverLevel,
      coverMultiplier: tier.multiplier,
      compulsoryExcessPence: tier.compulsoryExcessPence + rated.extraExcessPence,
      annualPremiumPence: annual,
      monthlyPremiumPence: monthly(annual, t),
    };
  });

  let outcome: PricedItem["outcome"] = "quoted";
  let reasonCode: string | null = null;
  if (rated.eligibility) {
    outcome = rated.eligibility.outcome;
    reasonCode = rated.eligibility.reason;
  } else {
    const chosen = options.find((o) => o.coverLevel === item.inputs.coverLevel)!;
    if (chosen.annualPremiumPence > t.param("max_premium_pence")) {
      outcome = "referred";
      reasonCode = "premium_above_max";
    }
  }

  return {
    outcome,
    reasonCode,
    factors: rated.factors,
    options,
    addons: rated.addons,
    iptRate: t.param("ipt_rate"),
  };
}
