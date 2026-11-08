import { coverLevels, type Product } from "#/server/db/schema/values";

import { CROWN_DEPENDENCIES, UK_POSTCODE_AREAS } from "../postcode-areas";
import type { RatingFactor, RatingSource } from "./types";

// Checks a rating source before the deploy writes it (4.8, calls 12, 13, 17). Returns every
// problem, so one run of the build shows them all; an empty list means it's valid.

/** Where a numeric factor's lowest band must start (or below); any other range factor floors at 0. */
export const RANGE_FLOORS: Readonly<Record<string, number>> = {
  driver_age: 17,
  named_driver_age: 17,
  insurance_group: 1,
};

const SHARED = [
  "min_premium_pence",
  "max_premium_pence",
  "ipt_rate",
  "fee_pence",
  "monthly_credit_charge_rate",
  "bundle_discount_rate",
];
const BANDS = ["a", "b", "c", "d", "e"];

/** The parameter names each product's version must have, from the spec's v1 tables. */
export const REQUIRED_PARAMETERS: Readonly<Record<Product, readonly string[]>> = {
  car: [
    "base_rate_pence",
    ...SHARED,
    "young_driver_excess_pence",
    "refer_insurance_group_min",
    "refer_value_pence_min",
    "decline_value_pence_min",
    "decline_young_age_max",
    "decline_young_group_min",
    "decline_under25_group_min",
    "refer_past_claims_min",
    "refer_new_licence_years_max",
    "refer_new_licence_group_min",
    "refer_age_min",
  ],
  home: [
    "buildings_rate_pence",
    "contents_rate_pence",
    ...SHARED,
    "escape_of_water_excess_pence",
    "subsidence_excess_pence",
    "refer_rebuild_pence_min",
    "decline_rebuild_pence_min",
    "refer_contents_pence_min",
    "refer_year_built_max",
    "refer_past_claims_min",
  ],
  business: [
    ...SHARED,
    "refer_turnover_pence_min",
    "refer_employees_min",
    "refer_high_risk_employees_min",
    ...BANDS.map((band) => `pl_rate_pence_${band}`),
    ...BANDS.map((band) => `el_rate_pence_${band}`),
  ],
};

// numeric(8,4) for multipliers, numeric(14,4) for parameters: Postgres would round a fifth place
// silently, and the stored tables would no longer match the source or its hash
const fourPlaces = (value: number) => Math.round(value * 1e4) / 1e4 === value;

function checkMultiplier(where: string, value: number, problems: string[]) {
  if (!(value > 0)) problems.push(`${where}: multiplier must be > 0`);
  else if (!fourPlaces(value)) problems.push(`${where}: multiplier has more than 4 decimal places`);
}

function checkRanges(factor: string, bands: RatingFactor[], problems: string[]) {
  if (bands.some((band) => band.rangeFrom === null)) {
    problems.push(`${factor}: every band needs a range when one has`);
    return;
  }
  const sorted = [...bands].sort((a, b) => a.rangeFrom! - b.rangeFrom!);
  const floor = RANGE_FLOORS[factor] ?? 0;
  if (sorted[0]!.rangeFrom! > floor) {
    problems.push(`${factor}: starts at ${sorted[0]!.rangeFrom}, floor is ${floor}`);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const band = sorted[i]!;
    if (prev.rangeTo === null || band.rangeFrom! <= prev.rangeTo) {
      problems.push(`${factor}: overlap at ${band.rangeFrom}`);
    } else if (band.rangeFrom! > prev.rangeTo + 1) {
      problems.push(`${factor}: gap after ${prev.rangeTo}`);
    }
  }
  if (sorted.at(-1)!.rangeTo !== null) problems.push(`${factor}: no open-ended top band`);
}

export function validateRatingSource(source: RatingSource): string[] {
  const problems: string[] = [];

  for (const name of REQUIRED_PARAMETERS[source.product]) {
    if (!(name in source.parameters)) problems.push(`missing parameter ${name}`);
  }
  for (const [name, value] of Object.entries(source.parameters)) {
    if (!fourPlaces(value)) problems.push(`parameter ${name}: more than 4 decimal places`);
    if (Math.abs(value) >= 1e10) problems.push(`parameter ${name}: too large for numeric(14,4)`);
  }

  const levels = source.tiers.map((tier) => tier.coverLevel).sort();
  if (levels.join() !== [...coverLevels].sort().join()) {
    problems.push(`tiers: expected ${coverLevels.join(", ")}`);
  }
  for (const tier of source.tiers)
    checkMultiplier(`tier ${tier.coverLevel}`, tier.multiplier, problems);

  const byFactor = new Map<string, RatingFactor[]>();
  for (const row of source.factors) {
    checkMultiplier(`${row.factor} ${row.band}`, row.multiplier, problems);
    const bands = byFactor.get(row.factor) ?? [];
    if (bands.some((band) => band.band === row.band)) {
      problems.push(`${row.factor}: band ${row.band} listed twice`);
    }
    bands.push(row);
    byFactor.set(row.factor, bands);
  }
  for (const [factor, bands] of byFactor) {
    if (bands.some((band) => band.rangeFrom !== null || band.rangeTo !== null)) {
      checkRanges(factor, bands, problems);
    }
  }

  for (const addon of source.addons) {
    for (const factor of addon.factors) {
      if (!byFactor.has(factor)) problems.push(`addon ${addon.addon}: unknown factor ${factor}`);
    }
  }

  const keysByFactor = new Map<string, Set<string>>();
  for (const lookup of source.lookups) {
    const bands = byFactor.get(lookup.factor);
    if (!bands?.some((band) => band.band === lookup.band)) {
      problems.push(`${lookup.factor}: unknown band ${lookup.band}`);
    }
    const keys = keysByFactor.get(lookup.factor) ?? new Set<string>();
    if (keys.has(lookup.key)) {
      problems.push(
        lookup.lookup === "postcode_area"
          ? `${lookup.factor}: area ${lookup.key} listed twice`
          : `${lookup.factor}: key ${lookup.key} listed twice`,
      );
    }
    keys.add(lookup.key);
    keysByFactor.set(lookup.factor, keys);
  }

  const postcodeFactors = new Set(
    source.lookups.filter((l) => l.lookup === "postcode_area").map((l) => l.factor),
  );
  const known = new Set<string>(UK_POSTCODE_AREAS);
  const outside = new Set<string>(CROWN_DEPENDENCIES);
  for (const factor of postcodeFactors) {
    const keys = keysByFactor.get(factor)!;
    for (const area of UK_POSTCODE_AREAS) {
      if (!keys.has(area)) problems.push(`${factor}: missing area ${area}`);
    }
    for (const key of keys) {
      if (outside.has(key)) problems.push(`${factor}: ${key} is outside the cover area`);
      else if (!known.has(key)) problems.push(`${factor}: unknown area ${key}`);
    }
  }

  return problems;
}
