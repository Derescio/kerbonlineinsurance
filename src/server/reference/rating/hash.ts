import { createHash } from "node:crypto";

import type { RatingSource } from "./types";

// A version's fingerprint (4.8, call 9): SHA-256 of its rates in a canonical form, so row and key
// order don't matter and the stored hash matches the source exactly. Notes and the effective date
// aren't rates, so they're left out.

const four = (value: number) => value.toFixed(4);
const byKey = <T>(rows: T[], key: (row: T) => string) =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function contentHash(source: RatingSource): string {
  const canonical = {
    product: source.product,
    version: source.version,
    parameters: byKey(Object.entries(source.parameters), ([name]) => name).map(([name, value]) => [
      name,
      four(value),
    ]),
    tiers: byKey(source.tiers, (t) => t.coverLevel).map((t) => [
      t.coverLevel,
      four(t.multiplier),
      t.compulsoryExcessPence,
    ]),
    addons: byKey(source.addons, (a) => a.addon).map((a) => [
      a.addon,
      a.annualPricePence,
      [...a.factors].sort(),
      a.availableToGroups ? [...a.availableToGroups].sort() : null,
    ]),
    factors: byKey(source.factors, (f) => `${f.factor}\u0000${f.band}`).map((f) => [
      f.factor,
      f.band,
      f.rangeFrom,
      f.rangeTo,
      four(f.multiplier),
    ]),
    lookups: byKey(source.lookups, (l) => `${l.factor}\u0000${l.key}`).map((l) => [
      l.lookup,
      l.factor,
      l.key,
      l.label,
      l.group,
      l.band,
    ]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
