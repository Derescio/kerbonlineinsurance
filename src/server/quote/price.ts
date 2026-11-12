import { parseJourney } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { todayIso } from "#/features/quote/schemas/dates";
import { firstIncompleteStep, type DriverStep } from "#/features/quote/steps";
import { carInputsFromJourney } from "#/features/rating/car-journey";
import { monthlyPayment } from "#/features/rating/money";
import { priceQuote } from "#/features/rating/price-quote";
import { RateLimitError } from "#/server/auth/errors";
import { getActiveRatingTables, getCatalogue } from "#/server/data/reference";
import { limit, rateLimitSubject } from "#/server/db/rate-limit";
import { CROWN_DEPENDENCIES } from "#/server/reference/postcode-areas";

// The car price for the holding view (5.4, spec decisions 3 and 4). The journey is read and checked
// as the tab reads it; the car's value and group come from the catalogue, never the browser; the
// answer carries the price or the outcome and nothing of the tables. Nothing is saved, and the
// input is never logged: it holds names and dates of birth.

export const QUOTE_PRICE_RULE = { max: 60, windowSeconds: 60 * 60 };

export type CarPriceResult =
  | { status: "quoted"; annualPence: number; monthlyPaymentPence: number }
  /** `namedDriver` is the 1-based position of the named driver a rule hit, else null */
  | { status: "referred" | "declined"; namedDriver: number | null }
  | { status: "invalid"; step: "car" | DriverStep }
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

  const journey = parseJourney(raw);
  if (!journey || normalisePostcode(journey.postcode) === null) return backToCar;
  const today = todayIso(now);
  const step = firstIncompleteStep(journey, today);
  if (step !== null) return { status: "invalid", step };

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

  const quote = priceQuote([
    {
      product: "car",
      inputs,
      tables,
      coverLevel: "comprehensive",
      addons: [],
    },
  ]);
  const item = quote.items[0]!;
  if (item.outcome !== "quoted") {
    return {
      status: item.outcome,
      namedDriver: typeof item.driver === "number" ? item.driver : null,
    };
  }
  const annualPence = item.selected!.totalPence;
  return {
    status: "quoted",
    annualPence,
    monthlyPaymentPence: monthlyPayment(annualPence, quote.monthlyCreditChargeRate),
  };
}
