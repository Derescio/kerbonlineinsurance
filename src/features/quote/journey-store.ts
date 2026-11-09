import { z } from "zod";

import type { BuyableProductId } from "./products";

// A guest's quote lives in the tab until the sign-in gate (4.2 decision 5; 5.1, call 9). One
// versioned object per product in sessionStorage: it survives a refresh but not closing the tab,
// so a shared computer doesn't keep someone's answers. 5.1 stores the postcode and the start;
// 5.2 onwards add their answers. Storage can be missing or throw (some private modes): then the
// journey works for this page only, with no warning.

const journeySchema = z.object({
  version: z.literal(1),
  /** Random, made here; `quote.started` is written once per id (plan P1) */
  journeyId: z.uuid(),
  postcode: z.string(),
  startedAt: z.iso.datetime(),
  /** The `quote.started` event has been sent for this journey */
  startRecorded: z.boolean(),
});

export type Journey = z.infer<typeof journeySchema>;

export type JourneyStorage = Pick<Storage, "getItem" | "setItem">;

export function journeyKey(product: BuyableProductId): string {
  return `kerb.quote.v1.${product}`;
}

/** The tab's sessionStorage, or null where there's none or reading it throws */
export function sessionStore(): JourneyStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJourney(
  product: BuyableProductId,
  storage: JourneyStorage | null = sessionStore(),
): Journey | null {
  try {
    const raw = storage?.getItem(journeyKey(product));
    if (!raw) return null;
    const parsed = journeySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeJourney(
  product: BuyableProductId,
  journey: Journey,
  storage: JourneyStorage | null,
): void {
  try {
    storage?.setItem(journeyKey(product), JSON.stringify(journey));
  } catch {
    // Full or blocked: this page still has the journey it was given
  }
}

/**
 * The product's journey with this postcode: the stored one with its postcode updated (plan P7),
 * or a new one. Always returns a journey, written if storage allows.
 */
export function beginJourney(
  product: BuyableProductId,
  postcode: string,
  now: Date = new Date(),
  storage: JourneyStorage | null = sessionStore(),
): Journey {
  const stored = readJourney(product, storage);
  const journey: Journey = stored
    ? { ...stored, postcode }
    : {
        version: 1,
        journeyId: crypto.randomUUID(),
        postcode,
        startedAt: now.toISOString(),
        startRecorded: false,
      };
  writeJourney(product, journey, storage);
  return journey;
}

export function markStartRecorded(
  product: BuyableProductId,
  storage: JourneyStorage | null = sessionStore(),
): void {
  const stored = readJourney(product, storage);
  if (stored) writeJourney(product, { ...stored, startRecorded: true }, storage);
}
