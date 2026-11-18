import { firstIncompleteHomeStep, type HomeStep } from "#/features/quote/home-steps";
import { parseJourney, type Journey } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { todayIso } from "#/features/quote/schemas/dates";
import { homeInputsFromJourney } from "#/features/rating/home-journey";
import type { HomeInputs } from "#/features/rating/types";
import { getActiveRatingTables, type RatingTables } from "#/server/data/reference";
import { CROWN_DEPENDENCIES } from "#/server/reference/postcode-areas";

// The home journey's checks before it's priced (5.7, decision 7), shared by the price and the save,
// as car-check.ts is for car. The journey is read and checked as the tab reads it.

export type HomeCheck =
  | { ok: true; journey: Journey; inputs: HomeInputs; tables: RatingTables; today: string }
  | { ok: false; step: HomeStep | "cover" };

/** `raw` is `{ journey, voluntaryExcessPence }`, as the price server function receives it */
export async function checkHomeJourney(raw: unknown, now: Date): Promise<HomeCheck> {
  const input = (raw ?? {}) as { journey?: unknown; voluntaryExcessPence?: unknown };
  const journey = parseJourney(input.journey);
  if (!journey) return { ok: false, step: "about" };
  // The postcode is the Property step's (decision 4)
  if (normalisePostcode(journey.postcode) === null) return { ok: false, step: "property" };
  const today = todayIso(now);
  const step = firstIncompleteHomeStep(journey, today);
  if (step !== null) return { ok: false, step };
  // Home's rating v1 has no voluntary excess, so Choose cover offers none: anything but £0 goes
  // back to cover, which resets it
  if ((input.voluntaryExcessPence ?? 0) !== 0) return { ok: false, step: "cover" };

  const tables = await getActiveRatingTables("home");
  const inputs = homeInputsFromJourney(journey);
  const known = (lookup: string, key: string) =>
    tables.lookups.some((l) => l.lookup === lookup && l.key === key);
  // An occupation a version that rates it doesn't know is About you to answer again, as car's is
  // (5.7c): v1 doesn't rate it
  const ratesOccupation = tables.lookups.some((l) => l.lookup === "occupation");
  if (ratesOccupation && !known("occupation", inputs.occupation)) {
    return { ok: false, step: "about" };
  }
  // An area the active version doesn't know is a postcode to change, not an error. Crown
  // dependencies pass, and priceQuote declines them (outside_cover_area).
  if (
    !(CROWN_DEPENDENCIES as readonly string[]).includes(inputs.postcodeArea) &&
    !known("postcode_area", inputs.postcodeArea)
  ) {
    return { ok: false, step: "property" };
  }
  return { ok: true, journey, inputs, tables, today };
}
