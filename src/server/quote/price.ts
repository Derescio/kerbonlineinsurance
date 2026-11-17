import type { CoverPrices, TierPrice } from "#/features/quote/cover";
import type { HomeStep } from "#/features/quote/home-steps";
import type { DriverStep } from "#/features/quote/steps";
import { priceQuote } from "#/features/rating/price-quote";
import { Tables } from "#/features/rating/tables";
import type { CarInputs, HomeInputs } from "#/features/rating/types";
import { RateLimitError } from "#/server/auth/errors";
import type { RatingTables } from "#/server/data/reference";
import { coverLevels } from "#/server/db/schema/values";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";

import { checkCarJourney } from "./car-check";
import { checkHomeJourney } from "./home-check";

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

/** The home price (5.7, decision 7): car's shape, with no named driver and home's steps */
export type HomePriceResult =
  | ({ status: "quoted" } & CoverPrices)
  | { status: "referred" | "declined"; namedDriver: null }
  | { status: "invalid"; step: HomeStep | "cover" }
  | { status: "rate_limited" };

/** Either product's price, as the shared quote screens read it */
export type QuotePriceResult = CarPriceResult | HomePriceResult;

async function limited(headers: Headers, secret?: string): Promise<boolean> {
  const subject = await rateLimitSubject(null, headers, secret);
  try {
    await limit(`quote.price:${subject}`, QUOTE_PRICE_RULE);
    return false;
  } catch (error) {
    if (error instanceof RateLimitError) return true;
    throw error;
  }
}

/** The home journey's price at every level, or its outcome. Nothing is saved, nothing logged. */
export async function priceHomeJourney(
  raw: unknown,
  headers: Headers,
  now: Date = new Date(),
  secret?: string,
): Promise<HomePriceResult> {
  if (await limited(headers, secret)) return { status: "rate_limited" };
  const checked = await checkHomeJourney(raw, now);
  if (!checked.ok) return { status: "invalid", step: checked.step };
  return coverPrices("home", checked.inputs, checked.tables) as Extract<
    HomePriceResult,
    { status: "quoted" | "referred" | "declined" }
  >;
}

export async function priceCarJourney(
  raw: unknown,
  headers: Headers,
  now: Date = new Date(),
  secret?: string,
): Promise<CarPriceResult> {
  if (await limited(headers, secret)) return { status: "rate_limited" };
  const checked = await checkCarJourney(raw, now);
  if (!checked.ok) return { status: "invalid", step: checked.step };
  return carPrices(checked.inputs, checked.tables);
}

/** Every cover level's car price for checked inputs, or the quote's outcome */
export function carPrices(
  inputs: CarInputs,
  tables: RatingTables,
): Extract<CarPriceResult, { status: "quoted" | "referred" | "declined" }> {
  return coverPrices("car", inputs, tables);
}

/**
 * Every cover level's price for checked inputs, or the quote's outcome when it isn't quoted. Home
 * has no named drivers, so its outcome's `namedDriver` is always null (5.7).
 */
export function coverPrices(
  product: "car" | "home",
  inputs: CarInputs | HomeInputs,
  tables: RatingTables,
): Extract<CarPriceResult, { status: "quoted" | "referred" | "declined" }> {
  // One priceQuote per level: only premium_above_max can tell them apart (5.5, decision 6)
  const priced = coverLevels.map((coverLevel) => {
    const quote = priceQuote([
      { product, inputs, tables, coverLevel, addons: [] } as Parameters<
        typeof priceQuote
      >[0][number],
    ]);
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
    voluntaryExcessPence: "voluntaryExcessPence" in inputs ? inputs.voluntaryExcessPence : 0,
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
