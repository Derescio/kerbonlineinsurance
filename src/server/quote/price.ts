import type { CoverPrices, TierPrice } from "#/features/quote/cover";
import type { DriverStep } from "#/features/quote/steps";
import { priceQuote } from "#/features/rating/price-quote";
import { Tables } from "#/features/rating/tables";
import type { CarInputs } from "#/features/rating/types";
import { RateLimitError } from "#/server/auth/errors";
import type { RatingTables } from "#/server/data/reference";
import { coverLevels } from "#/server/db/schema/values";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";

import { checkCarJourney } from "./car-check";

// The car price for Your quote and Choose cover (5.4, spec decisions 3 and 4; 5.5, decision 6). The
// journey is checked by checkCarJourney (car-check.ts), which the save shares (5.6); the answer
// carries every cover level's price at the asked voluntary excess, or the outcome, and nothing of
// the tables. Nothing is saved, and the input is never
// logged: it holds names and dates of birth.

export const QUOTE_PRICE_RULE = { max: 60, windowSeconds: 60 * 60 };

export type CarPriceResult =
  | ({ status: "quoted" } & CoverPrices)
  /** `namedDriver` is the 1-based position of the named driver a rule hit, else null */
  | { status: "referred" | "declined"; namedDriver: number | null }
  | { status: "invalid"; step: "car" | DriverStep | "cover" }
  | { status: "rate_limited" };

export async function priceCarJourney(
  raw: unknown,
  headers: Headers,
  now: Date = new Date(),
  secret?: string,
): Promise<CarPriceResult> {
  const subject = await rateLimitSubject(null, headers, secret);
  try {
    await limit(`quote.price:${subject}`, QUOTE_PRICE_RULE);
  } catch (error) {
    if (error instanceof RateLimitError) return { status: "rate_limited" };
    throw error;
  }

  const checked = await checkCarJourney(raw, now);
  if (!checked.ok) return { status: "invalid", step: checked.step };
  return carPrices(checked.inputs, checked.tables);
}

/** Every cover level's price for checked inputs, or the quote's outcome when it isn't quoted */
export function carPrices(
  inputs: CarInputs,
  tables: RatingTables,
): Extract<CarPriceResult, { status: "quoted" | "referred" | "declined" }> {
  // One priceQuote per level: only premium_above_max can tell them apart (5.5, decision 6)
  const priced = coverLevels.map((coverLevel) => {
    const quote = priceQuote([{ product: "car", inputs, tables, coverLevel, addons: [] }]);
    return { coverLevel, item: quote.items[0]! };
  });
  // The quote's own outcome is Comprehensive's (5.4)
  const item = priced.find((p) => p.coverLevel === "comprehensive")!.item;
  if (item.outcome !== "quoted") {
    return {
      status: item.outcome,
      namedDriver: typeof item.driver === "number" ? item.driver : null,
    };
  }
  const t = new Tables(tables);
  return {
    status: "quoted",
    voluntaryExcessPence: inputs.voluntaryExcessPence,
    levels: priced.map(({ coverLevel, item: level }): TierPrice => {
      const quoted = level.outcome === "quoted";
      return {
        coverLevel,
        outcome: quoted ? "quoted" : "referred",
        premiumPence: quoted ? level.selected!.premiumPence : null,
        compulsoryExcessPence: level.options.find((o) => o.coverLevel === coverLevel)!
          .compulsoryExcessPence,
      };
    }),
    addons: item.addons.map((a) => ({ addon: a.addon, annualPricePence: a.annualPricePence })),
    iptRate: t.param("ipt_rate"),
    feePence: t.param("fee_pence"),
    monthlyCreditChargeRate: t.param("monthly_credit_charge_rate"),
    bundleDiscountRate: t.param("bundle_discount_rate"),
  };
}
