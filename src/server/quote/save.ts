import { z } from "zod";

import { usableCover } from "#/features/quote/cover";
import { DEFAULT_COVER, parseJourney } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { startDateBounds } from "#/features/quote/policy-terms";
import type { DriverStep } from "#/features/quote/steps";
import { carDetailsFromJourney } from "#/features/rating/car-details";
import { priceQuote } from "#/features/rating/price-quote";
import { hasStaffRow } from "#/server/data/account";
import { defineWrite, rejected, type DataWrite } from "#/server/data/define";
import { QUOTE_SAVE_RULE } from "#/server/data/rate-limit-rules";
import { customerForQuote, saveQuote } from "#/server/data/save-quote";
import type { Tx } from "#/server/db/tx";

import { checkCarJourney } from "./car-check";
import { carPrices } from "./price";

// Saving a car quote at the gate (5.6, decisions 4 and 5). The browser's prices are never trusted:
// the journey is checked again as priceCar checks it, and priced again with the chosen cover from
// the catalogue and the active rating version. The customer row is made at the first save. A
// declined quote isn't saved, and staff can't buy. The journey holds names and dates of birth, so
// it's never logged; the answer holds ids and statuses only, as the idempotency record stores it.

export const STAFF_CANT_BUY = "Staff accounts can't buy policies.";

export type SaveCarResult =
  | { status: "saved"; quoteId: string; reference: string; outcome: "quoted" | "referred" }
  | { status: "invalid"; step: "car" | DriverStep | "cover" }
  | { status: "declined" }
  | { status: "staff" };

/**
 * Saves the user's car journey inside `tx`. Used by saveCarQuote and by the sign-up hook, which
 * has only the new user's id.
 */
export async function saveCarQuoteFor(
  tx: Tx,
  userId: string,
  input: { journey: unknown; now?: Date },
): Promise<SaveCarResult> {
  if (await hasStaffRow(tx, userId)) return { status: "staff" };
  const now = input.now ?? new Date();

  // Choose cover's choice, or its starting point when the save comes from Your quote (decision 13)
  const cover = parseJourney(input.journey)?.cover ?? DEFAULT_COVER;
  const checked = await checkCarJourney(
    { journey: input.journey, voluntaryExcessPence: cover.voluntaryExcessPence },
    now,
  );
  if (!checked.ok) return { status: "invalid", step: checked.step };
  const { journey, inputs, tables, car, today } = checked;

  const prices = carPrices(inputs, tables);
  if (prices.status === "declined") return { status: "declined" };
  // A referred quote keeps Comprehensive, the quote's own tier (5.4), for 6.11's review
  const chosen =
    prices.status === "quoted"
      ? usableCover(prices, cover)
      : { ...cover, coverLevel: "comprehensive" as const };
  const priced = priceQuote([
    { product: "car", inputs, tables, coverLevel: chosen.coverLevel, addons: chosen.addons },
  ]);
  const item = priced.items[0]!;
  if (item.outcome === "declined") return { status: "declined" };

  const postcode = normalisePostcode(journey.postcode)!;
  const main = journey.mainDriver!;
  const customerId = await customerForQuote(tx, userId, {
    firstName: main.firstName,
    lastName: main.lastName,
    dateOfBirth: main.dateOfBirth,
    addressLine1: main.addressLine1,
    addressLine2: main.addressLine2 || null,
    town: main.town,
    postcode,
  });
  const saved = await saveQuote(tx, {
    customerId,
    postcode,
    priced,
    items: [
      {
        // Tomorrow until Confirm and pay sets the chosen date (decision 8)
        startDate: startDateBounds(today).fallback,
        voluntaryExcessPence: cover.voluntaryExcessPence,
        details: carDetailsFromJourney(journey, car, today),
      },
    ],
    now,
  });
  return { status: "saved", ...saved, outcome: item.outcome };
}

export const saveCarQuote: DataWrite<SaveCarResult> = defineWrite(
  z.object({ journey: z.unknown() }),
  {
    limit: { action: "quote.save", rule: QUOTE_SAVE_RULE },
    idempotent: { action: "quote.save" },
  },
  async (actor, { journey }, tx) => {
    const result = await saveCarQuoteFor(tx, actor.userId, { journey });
    return result.status === "staff" ? rejected(STAFF_CANT_BUY) : result;
  },
);
