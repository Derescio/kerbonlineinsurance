import { isOfferedExcess } from "#/features/quote/cover";
import { parseJourney, type Journey } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { todayIso } from "#/features/quote/schemas/dates";
import { firstIncompleteStep, type DriverStep } from "#/features/quote/steps";
import { carInputsFromJourney } from "#/features/rating/car-journey";
import type { CarInputs } from "#/features/rating/types";
import {
  getActiveRatingTables,
  getCatalogue,
  type CatalogueRecord,
  type RatingTables,
} from "#/server/data/reference";
import { CROWN_DEPENDENCIES } from "#/server/reference/postcode-areas";

// The car journey's checks before it's priced (5.4, spec decisions 3 and 4; 5.5, decision 6), shared
// by the price (price.ts) and the save (save.ts, 5.6 decision 5). The journey is read and checked as
// the tab reads it, and the car's value and group come from the catalogue, never the browser.

export type CarCheck =
  | {
      ok: true;
      journey: Journey;
      inputs: CarInputs;
      tables: RatingTables;
      car: CatalogueRecord;
      today: string;
    }
  | { ok: false; step: "car" | DriverStep | "cover" };

const backToCar: CarCheck = { ok: false, step: "car" };

/** `raw` is `{ journey, voluntaryExcessPence }`, as the price server function receives it */
export async function checkCarJourney(raw: unknown, now: Date): Promise<CarCheck> {
  const input = (raw ?? {}) as { journey?: unknown; voluntaryExcessPence?: unknown };
  const journey = parseJourney(input.journey);
  if (!journey || normalisePostcode(journey.postcode) === null) return backToCar;
  const today = todayIso(now);
  const step = firstIncompleteStep(journey, today);
  if (step !== null) return { ok: false, step };
  const excess = input.voluntaryExcessPence ?? 0;
  if (!isOfferedExcess(excess)) return { ok: false, step: "cover" };

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
  if (!known("occupation", inputs.driver.occupation)) return { ok: false, step: "about" };
  if (
    !(CROWN_DEPENDENCIES as readonly string[]).includes(inputs.postcodeArea) &&
    !known("postcode_area", inputs.postcodeArea)
  ) {
    return backToCar;
  }
  return { ok: true, journey, inputs, tables, car, today };
}
