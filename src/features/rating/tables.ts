import type { RatingFactor } from "#/server/reference/rating/types";

import type { PricedFactor, RatingData } from "./types";

// Reads one rating version's tables. Anything missing throws, naming the product: a factor never
// silently defaults to 1 (phase row).

export class Tables {
  constructor(readonly data: RatingData) {}

  param(name: string): number {
    const value = this.data.parameters[name];
    if (value === undefined) throw new Error(`${this.data.product}: missing parameter ${name}`);
    return value;
  }

  private rows(factor: string): readonly RatingFactor[] {
    const rows = this.data.factors.filter((f) => f.factor === factor);
    if (rows.length === 0) throw new Error(`${this.data.product}: no factor ${factor}`);
    return rows;
  }

  range(factor: string, value: number): PricedFactor {
    const row = this.rows(factor).find(
      (r) =>
        r.rangeFrom !== null && r.rangeFrom <= value && (r.rangeTo === null || value <= r.rangeTo),
    );
    if (!row) throw new Error(`${this.data.product}: ${factor} has no band for ${value}`);
    return { factor, inputValue: row.band, multiplier: row.multiplier };
  }

  choice(factor: string, band: string): PricedFactor {
    const row = this.rows(factor).find((r) => r.band === band);
    if (!row) throw new Error(`${this.data.product}: ${factor} has no band ${band}`);
    return { factor, inputValue: band, multiplier: row.multiplier };
  }

  /** A lookup key's row, e.g. occupation teacher → band B; `label` names it in the error */
  lookup(kind: string, factor: string, key: string, label: string) {
    const row = this.data.lookups.find(
      (l) => l.lookup === kind && l.factor === factor && l.key === key,
    );
    if (!row) throw new Error(`${this.data.product}: unknown ${label}: ${key}`);
    return row;
  }
}
