import { normalisePostcode, postcodeError } from "./postcode";
import { isBuyable, isProductId, type ProductId } from "./products";

// The quote pages' search params (5.1, call 5). A link can carry `type` and `postcode` in either
// order; a bad value is dropped quietly, never shown as an error. `next=1` marks the start form's
// plain GET submit, which works without JavaScript (call 7).

export const typeError = "Choose what you'd like to insure.";

/** Shown on /quote when postcodes.io says the postcode doesn't exist (5.2, call 15) */
export const postcodeNotFoundError = "We couldn't find that postcode. Check it and try again.";

export interface StartSearch {
  type?: ProductId;
  postcode?: string;
  next?: 1;
  /** Set by /quote/car's redirect when postcodes.io doesn't know the postcode (5.2, call 15) */
  error?: "postcode";
}

/** The car step's three views: none is the registration (screen 08) (5.2, call 9) */
export type VehicleView = "manual" | "not-found";

/**
 * The driver steps, Your quote (5.3, call 5), Choose cover and the home offer (5.5), and the gate
 * (5.6, decision 2); none is the car step
 */
export const QUOTE_STEPS = [
  "about",
  "driving",
  "claims",
  "drivers",
  "quote",
  "cover",
  "add-home",
  "buy",
] as const;
export type QuoteStep = (typeof QUOTE_STEPS)[number];

export interface CarSearch {
  postcode?: string;
  vehicle?: VehicleView;
  step?: QuoteStep;
  /** The gate's create-account half, screen 15 (5.6, decision 2) */
  auth?: "signup";
  /** The gate goes on to Your saved quotes, not pay: Save and exit and the referred screens (5.6) */
  after?: "retrieve";
}

export interface ComingSoonSearch {
  type?: ProductId;
  postcode?: string;
}

/** TanStack parses each value as JSON first, so `?postcode=123` arrives as a number */
function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function linkPostcode(value: unknown): string | undefined {
  const raw = text(value);
  return raw === undefined ? undefined : (normalisePostcode(raw) ?? undefined);
}

function linkType(value: unknown): ProductId | undefined {
  return isProductId(value) ? value : undefined;
}

// Each parser returns every key it owns, undefined when dropped: TanStack merges a route's
// validated search over the raw one from the URL, so a key left out would bring the bad value back.

/** /quote. After a `next=1` submit the postcode is kept as typed, so the error can sit next to it. */
export function startSearch(raw: Record<string, unknown>): StartSearch {
  const next = raw.next === 1 || raw.next === "1";
  return {
    type: linkType(raw.type),
    postcode: next ? text(raw.postcode) : linkPostcode(raw.postcode),
    next: next ? 1 : undefined,
    error: raw.error === "postcode" ? "postcode" : undefined,
  };
}

/** /quote/car and /quote/home */
export function journeySearch(raw: Record<string, unknown>): { postcode?: string } {
  return { postcode: linkPostcode(raw.postcode) };
}

/** /quote/car. The plate and the driver answers never go in the URL (5.2, call 9; 5.3, call 5). */
export function carSearch(raw: Record<string, unknown>): CarSearch {
  const vehicle = raw.vehicle === "manual" || raw.vehicle === "not-found" ? raw.vehicle : undefined;
  const step = QUOTE_STEPS.find((known) => known === raw.step);
  // Only the gate reads these two, so they go with any other step
  const auth = step === "buy" && raw.auth === "signup" ? "signup" : undefined;
  const after = step === "buy" && raw.after === "retrieve" ? "retrieve" : undefined;
  return { postcode: linkPostcode(raw.postcode), vehicle, step, auth, after };
}

/** /quote/coming-soon */
export function comingSoonSearch(raw: Record<string, unknown>): ComingSoonSearch {
  return { type: linkType(raw.type), postcode: linkPostcode(raw.postcode) };
}

export type StartCheck =
  | {
      ok: true;
      to: "/quote/car" | "/quote/home" | "/quote/coming-soon";
      search: ComingSoonSearch;
    }
  | { ok: false; errors: { type?: string; postcode?: string } };

/**
 * Where the start form's Continue goes, or what's wrong. A postcode is required for car and home,
 * optional for a coming-soon type, and checked whenever one was given.
 */
export function checkStart(input: { type?: ProductId; postcode?: string }): StartCheck {
  const typed = input.postcode?.trim() ? input.postcode : undefined;
  const postcode = typed === undefined ? undefined : normalisePostcode(typed);
  const badPostcode = typed !== undefined && postcode === null;
  const { type } = input;

  if (!type) {
    return {
      ok: false,
      errors: { type: typeError, ...(badPostcode && { postcode: postcodeError }) },
    };
  }
  if (isBuyable(type)) {
    if (!postcode) return { ok: false, errors: { postcode: postcodeError } };
    return { ok: true, to: `/quote/${type}`, search: { postcode } };
  }
  if (badPostcode) return { ok: false, errors: { postcode: postcodeError } };
  return { ok: true, to: "/quote/coming-soon", search: { type, ...(postcode && { postcode }) } };
}

/** Coming soon is only for the five types not sold yet; anything else goes back to the start. */
export function comingSoonRedirect(search: ComingSoonSearch): ComingSoonSearch | null {
  if (search.type && !isBuyable(search.type)) return null;
  return search;
}
