import { POSTCODE_AREAS_V1, type PostcodeArea } from "../postcode-areas";
import type { RatingFactor, RatingLookup } from "./types";

// Small builders that keep the version files reading like the spec's tables.

/** Numeric bands, `[label, from, to, multiplier]`; a null `to` is "and above". */
export function ranges(
  factor: string,
  rows: readonly (readonly [string, number, number | null, number])[],
): RatingFactor[] {
  return rows.map(([band, rangeFrom, rangeTo, multiplier]) => ({
    factor,
    band,
    rangeFrom,
    rangeTo,
    multiplier,
  }));
}

/** Named bands with no range, `{ band: multiplier }`. */
export function choices(factor: string, rows: Readonly<Record<string, number>>): RatingFactor[] {
  return Object.entries(rows).map(([band, multiplier]) => ({
    factor,
    band,
    rangeFrom: null,
    rangeTo: null,
    multiplier,
  }));
}

/** The ten postcode band multipliers every postcode factor uses (spec, car v1). */
export const POSTCODE_BAND_MULTIPLIERS = [
  0.85, 0.9, 0.95, 1, 1.07, 1.15, 1.25, 1.38, 1.55, 1.75,
] as const;

export function postcodeBands(factor: string): RatingFactor[] {
  return POSTCODE_BAND_MULTIPLIERS.map((multiplier, i) => ({
    factor,
    band: String(i + 1),
    rangeFrom: null,
    rangeTo: null,
    multiplier,
  }));
}

/** One lookup row per postcode area, taking the band `pick` chooses (car, buildings or contents). */
export function postcodeLookups(
  factor: string,
  pick: (area: PostcodeArea) => number,
): RatingLookup[] {
  return POSTCODE_AREAS_V1.map((area) => ({
    lookup: "postcode_area",
    factor,
    key: area.area,
    label: area.label,
    group: area.region,
    band: String(pick(area)),
  }));
}

/** Lookup rows from `{ band: [[key, label], ...] }`. */
export function listLookups(
  lookup: "occupation" | "trade",
  factor: string,
  rows: readonly { band: string; group: string | null; items: readonly [string, string][] }[],
): RatingLookup[] {
  return rows.flatMap(({ band, group, items }) =>
    items.map(([key, label]) => ({ lookup, factor, key, label, group, band })),
  );
}
