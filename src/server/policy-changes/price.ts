import { annualSettlement, instalmentChange, priceLine } from "#/features/policy-changes/money";
import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import {
  priceQuote,
  withSingleItemSaving,
  type QuoteItemRequest,
} from "#/features/rating/price-quote";
import { Tables } from "#/features/rating/tables";
import type { PricedAddon } from "#/features/rating/types";
import type { StoredPolicy } from "#/server/data/policy-change-rows";
import type { RatingTables } from "#/server/data/reference";
import { coverLevels, type CoverLevel, type ReasonCode } from "#/server/db/schema/values";

import { carInputsFromPolicy } from "./inputs";

// What a change costs (6.3b, decisions 4 and 5). The policy is priced twice today on the rating
// version it was bought on, as it stands and with the change, each with the policy's saving at the
// version's rate; only the difference is charged, for the part of the year that's left.

/** One side of the comparison: the car's money for a year */
export interface CarPrice {
  coverLevel: CoverLevel;
  premiumPence: number;
  discountPence: number;
  addons: PricedAddon[];
  addonsPence: number;
  iptPence: number;
  feePence: number;
  /** Everything for the year: premium less saving, add-ons, IPT and fee */
  totalPence: number;
  /** premium − saving + add-ons: what policies.annual_premium_pence holds */
  annualPence: number;
  compulsoryExcessPence: number;
}

type Side =
  | { outcome: "quoted"; price: CarPrice }
  | { outcome: "referred" | "declined"; reasonCode: ReasonCode | null };

export type PricedChange =
  | {
      outcome: "quoted";
      before: CarPrice;
      after: CarPrice;
      oldAnnualPence: number;
      newAnnualPence: number;
      /** after.totalPence − before.totalPence: the year's difference with IPT */
      diffPence: number;
      settlement: "charge" | "refund" | "instalments" | "none";
      /** The top-up or refund (annual), or the change to each remaining instalment (monthly) */
      amountPence: number;
      priceLine: string;
    }
  | { outcome: "referred" | "declined"; reasonCode: ReasonCode | null };

function priceSide(
  stored: StoredPolicy,
  tables: RatingTables,
  today: string,
  change?: PolicyChangeRequest,
): Side {
  const { inputs, coverLevel, addons } = carInputsFromPolicy(stored, today, change);
  const t = new Tables(tables);
  let priced = priceQuote([
    { product: "car", inputs, tables, coverLevel, addons } as QuoteItemRequest,
  ]);
  // The policy's saving, at the version's rate, whichever kind it had (bundle or multi-policy)
  if (stored.quote.bundleDiscountPence > 0) {
    priced = withSingleItemSaving(priced, t.param("bundle_discount_rate"), t.param("ipt_rate"));
  }
  const item = priced.items[0]!;
  if (item.outcome !== "quoted" || !item.selected) {
    return {
      outcome: item.outcome === "declined" ? "declined" : "referred",
      reasonCode: item.reasonCode,
    };
  }
  const s = item.selected;
  const chosen = item.addons.filter((a) => addons.includes(a.addon));
  return {
    outcome: "quoted",
    price: {
      coverLevel,
      premiumPence: s.premiumPence,
      discountPence: s.discountPence,
      addons: chosen,
      addonsPence: s.addonsPence,
      iptPence: s.iptPence,
      feePence: s.feePence,
      totalPence: s.totalPence,
      annualPence: s.premiumPence - s.discountPence + s.addonsPence,
      compulsoryExcessPence: item.options.find((o) => o.coverLevel === coverLevel)!
        .compulsoryExcessPence,
    },
  };
}

export function priceChange(
  stored: StoredPolicy,
  change: PolicyChangeRequest,
  tables: RatingTables,
  today: string,
): PricedChange {
  const before = priceSide(stored, tables, today);
  if (before.outcome !== "quoted") return before;
  const after = priceSide(stored, tables, today, change);
  if (after.outcome !== "quoted") return after;

  const { policy } = stored;
  const diffPence = after.price.totalPence - before.price.totalPence;
  const oldAnnualPence = policy.annualPremiumPence;
  const newAnnualPence = Math.max(
    1,
    oldAnnualPence + after.price.annualPence - before.price.annualPence,
  );
  const base = {
    outcome: "quoted" as const,
    before: before.price,
    after: after.price,
    oldAnnualPence,
    newAnnualPence,
    diffPence,
  };

  if (stored.quote.paymentPlan === "monthly") {
    const each = instalmentChange(
      diffPence,
      today,
      policy.startsOn,
      policy.endsOn,
      new Tables(tables).param("monthly_credit_charge_rate"),
      stored.scheduledInstalments,
    );
    return {
      ...base,
      settlement: each === 0 ? "none" : "instalments",
      amountPence: each,
      priceLine: priceLine("monthly", Math.abs(each), each > 0 ? "up" : each < 0 ? "down" : "same"),
    };
  }
  const settled = annualSettlement(diffPence, today, policy.startsOn, policy.endsOn);
  return {
    ...base,
    settlement: settled.kind,
    amountPence: settled.pence,
    priceLine: priceLine(
      "annual",
      settled.pence,
      settled.kind === "charge" ? "up" : settled.kind === "refund" ? "down" : "same",
    ),
  };
}

/** Each cover level's price line with the same add-ons and excess (the Change cover dialog) */
export function coverLevelLines(
  stored: StoredPolicy,
  change: Extract<PolicyChangeRequest, { kind: "cover" }>,
  tables: RatingTables,
  today: string,
): { coverLevel: CoverLevel; available: boolean; priceLine: string | null }[] {
  return coverLevels.map((coverLevel) => {
    const priced = priceChange(stored, { ...change, coverLevel }, tables, today);
    return priced.outcome === "quoted"
      ? { coverLevel, available: true, priceLine: priced.priceLine }
      : { coverLevel, available: false, priceLine: null };
  });
}

/** The add-ons offered on this policy's car, priced for a year */
export function offeredAddons(
  stored: StoredPolicy,
  tables: RatingTables,
  today: string,
): { addon: string; annualPricePence: number }[] {
  const { inputs, coverLevel } = carInputsFromPolicy(stored, today);
  const priced = priceQuote([
    { product: "car", inputs, tables, coverLevel, addons: [] } as QuoteItemRequest,
  ]);
  return priced.items[0]!.addons.map((a) => ({
    addon: a.addon,
    annualPricePence: a.annualPricePence,
  }));
}
