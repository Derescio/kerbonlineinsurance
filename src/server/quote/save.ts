import { z } from "zod";

import { samePerson } from "#/features/quote/bundle";
import { usableCover } from "#/features/quote/cover";
import type { HomeStep } from "#/features/quote/home-steps";
import { DEFAULT_COVER, parseJourney } from "#/features/quote/journey-store";
import { normalisePostcode } from "#/features/quote/postcode";
import { startDateBounds } from "#/features/quote/policy-terms";
import type { DriverStep } from "#/features/quote/steps";
import { carDetailsFromJourney } from "#/features/rating/car-details";
import { homeDetailsFromJourney } from "#/features/rating/home-details";
import { priceQuote } from "#/features/rating/price-quote";
import { defineWrite, type DataWrite } from "#/server/data/define";
import { QUOTE_SAVE_RULE } from "#/server/data/rate-limit-rules";
import { customerForQuote, saveQuote } from "#/server/data/save-quote";
import type { Tx } from "#/server/db/tx";

import { checkCarJourney } from "./car-check";
import { checkHomeJourney } from "./home-check";
import { carPrices, coverPrices } from "./price";

// Saving a car quote at the gate (5.6, decisions 4 and 5). The browser's prices are never trusted:
// the journey is checked again as priceCar checks it, and priced again with the chosen cover from
// the catalogue and the active rating version. The customer row is made at the first save. A
// declined quote isn't saved. Staff buy like anyone else: 4.5's conflict-of-interest rule keeps
// them off their own claims and referrals. The journey holds names and dates of birth, so
// it's never logged; the answer holds ids and statuses only, as the idempotency record stores it.

export type SaveCarResult =
  | { status: "saved"; quoteId: string; reference: string; outcome: "quoted" | "referred" }
  | { status: "invalid"; step: "car" | DriverStep | "cover" }
  | { status: "declined" };

/**
 * Saves the user's car journey inside `tx`. Used by saveCarQuote and by the sign-up hook, which
 * has only the new user's id.
 */
export async function saveCarQuoteFor(
  tx: Tx,
  userId: string,
  input: { journey: unknown; now?: Date },
): Promise<SaveCarResult> {
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
    return saveCarQuoteFor(tx, actor.userId, { journey });
  },
);

/** A home save's answer (5.7, decision 9): car's, with home's steps */
export type SaveHomeResult =
  | { status: "saved"; quoteId: string; reference: string; outcome: "quoted" | "referred" }
  | { status: "invalid"; step: HomeStep | "cover" }
  | { status: "declined" };

/**
 * Saves the user's home journey inside `tx` (5.7, decision 9), as saveCarQuoteFor does for car:
 * checked and priced again, the customer made from About you and the insured address at the first
 * save, and a declined quote not saved. Used by saveHomeQuote and by the sign-up hook.
 */
export async function saveHomeQuoteFor(
  tx: Tx,
  userId: string,
  input: { journey: unknown; now?: Date },
): Promise<SaveHomeResult> {
  const now = input.now ?? new Date();
  const cover = parseJourney(input.journey)?.cover ?? DEFAULT_COVER;
  const checked = await checkHomeJourney(
    { journey: input.journey, voluntaryExcessPence: cover.voluntaryExcessPence },
    now,
  );
  if (!checked.ok) return { status: "invalid", step: checked.step };
  const { journey, inputs, tables, today } = checked;

  const prices = coverPrices("home", inputs, tables);
  if (prices.status === "declined") return { status: "declined" };
  const chosen =
    prices.status === "quoted"
      ? usableCover(prices, cover)
      : { ...cover, coverLevel: "comprehensive" as const };
  const priced = priceQuote([
    { product: "home", inputs, tables, coverLevel: chosen.coverLevel, addons: chosen.addons },
  ]);
  const item = priced.items[0]!;
  if (item.outcome === "declined") return { status: "declined" };

  const postcode = normalisePostcode(journey.postcode)!;
  const about = journey.homeAbout!;
  const address = journey.property!.address!;
  const customerId = await customerForQuote(tx, userId, {
    firstName: about.firstName,
    lastName: about.lastName,
    dateOfBirth: about.dateOfBirth,
    addressLine1: address.line1,
    addressLine2: address.line2 || null,
    town: address.town,
    postcode,
  });
  const saved = await saveQuote(tx, {
    customerId,
    postcode,
    priced,
    items: [
      {
        startDate: startDateBounds(today).fallback,
        voluntaryExcessPence: 0,
        details: homeDetailsFromJourney(journey),
      },
    ],
    now,
  });
  return { status: "saved", ...saved, outcome: item.outcome };
}

export const saveHomeQuote: DataWrite<SaveHomeResult> = defineWrite(
  z.object({ journey: z.unknown() }),
  {
    limit: { action: "quote.save", rule: QUOTE_SAVE_RULE },
    idempotent: { action: "quote.save" },
  },
  async (actor, { journey }, tx) => {
    return saveHomeQuoteFor(tx, actor.userId, { journey });
  },
);

/** A bundle save's answer (5.7b, decision 6): which half stopped it, when one did */
export type SaveBundleResult =
  | { status: "saved"; quoteId: string; reference: string }
  | { status: "invalid"; product: "car"; step: "car" | DriverStep | "cover" }
  | { status: "invalid"; product: "home"; step: HomeStep | "cover" }
  | { status: "not_quoted"; product: "car" | "home"; outcome: "referred" | "declined" }
  | { status: "mismatch" };

/**
 * Saves the user's car and home journeys as one quote with the bundle saving (5.7b, decision 6).
 * Each is checked and priced again as its own save does, then both are priced together; nothing
 * is saved unless both are quoted and name the same policyholder. The customer comes from car's
 * main driver, and the quote's postcode is car's (the home keeps its own on its property row).
 */
export async function saveBundleQuoteFor(
  tx: Tx,
  userId: string,
  input: { car: unknown; home: unknown; now?: Date },
): Promise<SaveBundleResult> {
  const now = input.now ?? new Date();
  const carCover = parseJourney(input.car)?.cover ?? DEFAULT_COVER;
  const homeCover = parseJourney(input.home)?.cover ?? DEFAULT_COVER;

  const car = await checkCarJourney(
    { journey: input.car, voluntaryExcessPence: carCover.voluntaryExcessPence },
    now,
  );
  if (!car.ok) return { status: "invalid", product: "car", step: car.step };
  const home = await checkHomeJourney(
    { journey: input.home, voluntaryExcessPence: homeCover.voluntaryExcessPence },
    now,
  );
  if (!home.ok) return { status: "invalid", product: "home", step: home.step };

  const carPriced = coverPrices("car", car.inputs, car.tables);
  if (carPriced.status !== "quoted") {
    return { status: "not_quoted", product: "car", outcome: carPriced.status };
  }
  const homePriced = coverPrices("home", home.inputs, home.tables);
  if (homePriced.status !== "quoted") {
    return { status: "not_quoted", product: "home", outcome: homePriced.status };
  }
  const carChosen = usableCover(carPriced, carCover);
  const homeChosen = usableCover(homePriced, homeCover);
  const priced = priceQuote([
    {
      product: "car",
      inputs: car.inputs,
      tables: car.tables,
      coverLevel: carChosen.coverLevel,
      addons: carChosen.addons,
    },
    {
      product: "home",
      inputs: home.inputs,
      tables: home.tables,
      coverLevel: homeChosen.coverLevel,
      addons: homeChosen.addons,
    },
  ]);
  for (const item of priced.items) {
    if (item.outcome !== "quoted") {
      return {
        status: "not_quoted",
        product: item.product as "car" | "home",
        outcome: item.outcome,
      };
    }
  }

  // One policyholder per bundle; a half that can't be bought is said first, so its screen shows
  const main = car.journey.mainDriver!;
  if (!samePerson(main, home.journey.homeAbout!)) return { status: "mismatch" };

  const postcode = normalisePostcode(car.journey.postcode)!;
  const customerId = await customerForQuote(tx, userId, {
    firstName: main.firstName,
    lastName: main.lastName,
    dateOfBirth: main.dateOfBirth,
    addressLine1: main.addressLine1,
    addressLine2: main.addressLine2 || null,
    town: main.town,
    postcode,
  });
  const startDate = startDateBounds(car.today).fallback;
  const saved = await saveQuote(tx, {
    customerId,
    postcode,
    priced,
    items: [
      {
        startDate,
        voluntaryExcessPence: carChosen.voluntaryExcessPence,
        details: carDetailsFromJourney(car.journey, car.car, car.today),
      },
      { startDate, voluntaryExcessPence: 0, details: homeDetailsFromJourney(home.journey) },
    ],
    now,
  });
  return { status: "saved", ...saved };
}

export const saveBundleQuote: DataWrite<SaveBundleResult> = defineWrite(
  z.object({ car: z.unknown(), home: z.unknown() }),
  {
    limit: { action: "quote.save", rule: QUOTE_SAVE_RULE },
    idempotent: { action: "quote.save" },
  },
  async (actor, { car, home }, tx) => {
    return saveBundleQuoteFor(tx, actor.userId, { car, home });
  },
);
