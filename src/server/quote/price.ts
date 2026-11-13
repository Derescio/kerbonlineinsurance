import { isOfferedExcess, type CoverPrices, type TierPrice } from "#/features/quote/cover";
import { parseJourney } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { todayIso } from "#/features/quote/schemas/dates";
import { firstIncompleteStep, type DriverStep } from "#/features/quote/steps";
import { carInputsFromJourney } from "#/features/rating/car-journey";
import { priceQuote } from "#/features/rating/price-quote";
import { Tables } from "#/features/rating/tables";
import { RateLimitError } from "#/server/auth/errors";
import { getActiveRatingTables, getCatalogue } from "#/server/data/reference";
import { coverLevels } from "#/server/db/schema/values";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";
import { CROWN_DEPENDENCIES } from "#/server/reference/postcode-areas";

// The car price for Your quote and Choose cover (5.4, spec decisions 3 and 4; 5.5, decision 6). The
// journey is read and checked as the tab reads it; the car's value and group come from the
// catalogue, never the browser; the answer carries every cover level's price at the asked voluntary
// excess, or the outcome, and nothing of the tables. Nothing is saved, and the input is never
// logged: it holds names and dates of birth.

export const QUOTE_PRICE_RULE = { max: 60, windowSeconds: 60 * 60 };

export type CarPriceResult =
  | ({ status: "quoted" } & CoverPrices)
  /** `namedDriver` is the 1-based position of the named driver a rule hit, else null */
  | { status: "referred" | "declined"; namedDriver: number | null }
  | { status: "invalid"; step: "car" | DriverStep | "cover" }
  | { status: "rate_limited" };

const backToCar: CarPriceResult = { status: "invalid", step: "car" };

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

  const input = (raw ?? {}) as { journey?: unknown; voluntaryExcessPence?: unknown };
  const journey = parseJourney(input.journey);
  if (!journey || normalisePostcode(journey.postcode) === null) return backToCar;
  const today = todayIso(now);
  const step = firstIncompleteStep(journey, today);
  if (step !== null) return { status: "invalid", step };
  const excess = input.voluntaryExcessPence ?? 0;
  if (!isOfferedExcess(excess)) return { status: "invalid", step: "cover" };

  const car = (await getCatalogue()).find((r) => r.id === journey.vehicle!.catalogueVariantId);
  if (!car) return backToCar;

  const tables = await getActiveRatingTables("car");
  const inputs = carInputsFromJourney(
    journey,
    {
      year: car.year,
      insuranceGroup: car.insuranceGroup,
      fuelType: car.fuelType,
      valuePence: car.valuePence,
    },
    today,
    excess,
  );
  // A key the active version doesn't know (a v2 renamed it while a tab held the old one) is a step
  // to answer again, not an error: Try again could never succeed. Crown dependencies are declined.
  const known = (lookup: string, key: string) =>
    tables.lookups.some((l) => l.lookup === lookup && l.key === key);
  if (!known("occupation", inputs.driver.occupation)) return { status: "invalid", step: "about" };
  if (
    !(CROWN_DEPENDENCIES as readonly string[]).includes(inputs.postcodeArea) &&
    !known("postcode_area", inputs.postcodeArea)
  ) {
    return backToCar;
  }

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
    voluntaryExcessPence: excess,
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
