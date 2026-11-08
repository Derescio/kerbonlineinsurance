import { describe, expect, it } from "vite-plus/test";

import { contentHash } from "./hash";
import type { RatingSource } from "./types";

function source(): RatingSource {
  return {
    product: "car",
    version: 1,
    effectiveFrom: "2026-11-01",
    notes: "first",
    parameters: { base_rate_pence: 46_000, ipt_rate: 0.12 },
    tiers: [
      { coverLevel: "essential", multiplier: 0.96, compulsoryExcessPence: 25_000 },
      { coverLevel: "plus", multiplier: 1.18, compulsoryExcessPence: 15_000 },
    ],
    addons: [
      { addon: "motor_legal", annualPricePence: 2_500, factors: [], availableToGroups: null },
      { addon: "breakdown_uk", annualPricePence: 4_500, factors: [], availableToGroups: null },
    ],
    factors: [
      { factor: "usage", band: "social", rangeFrom: null, rangeTo: null, multiplier: 0.95 },
      { factor: "postcode_band", band: "5", rangeFrom: null, rangeTo: null, multiplier: 1.07 },
    ],
    lookups: [
      {
        lookup: "postcode_area",
        factor: "postcode_band",
        key: "LS",
        label: "Leeds",
        group: "Yorkshire",
        band: "5",
      },
    ],
  };
}

describe("contentHash", () => {
  it("is 64 hex characters", () => {
    expect(contentHash(source())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the order of rows and keys", () => {
    const shuffled = source();
    shuffled.tiers.reverse();
    shuffled.addons.reverse();
    shuffled.factors.reverse();
    shuffled.parameters = { ipt_rate: 0.12, base_rate_pence: 46_000 };
    expect(contentHash(shuffled)).toBe(contentHash(source()));
  });

  it("changes when a multiplier changes", () => {
    const changed = source();
    changed.factors[1]!.multiplier = 1.0701;
    expect(contentHash(changed)).not.toBe(contentHash(source()));
  });

  it("ignores the notes", () => {
    const renoted = source();
    renoted.notes = "second";
    expect(contentHash(renoted)).toBe(contentHash(source()));
  });
});
