import { z } from "zod";

import { coverLevels } from "#/server/db/schema/values";

import { statusOptions } from "./occupation";
import type { BuyableProductId } from "./products";
import {
  faultOptions,
  incidentTypeOptions,
  overnightOptions,
  relationshipOptions,
  usageOptions,
  type AboutYou,
  type Claims,
  type LicenceAndUsage,
  type NamedDrivers,
} from "./schemas/driver-steps";

// A guest's quote lives in the tab until the sign-in gate (4.2 decision 5; 5.1, call 9). One
// versioned object per product in sessionStorage: it survives a refresh but not closing the tab,
// so a shared computer doesn't keep someone's answers. 5.1 stores the postcode and the start;
// 5.2 onwards add their answers. Storage can be missing or throw (some private modes): then the
// journey works for this page only, with no warning.

/** The confirmed car (5.2, call 12): a snapshot of its catalogue row, as a quote's vehicles row keeps */
const vehicleSchema = z.object({
  catalogueVariantId: z.string().min(1),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  variant: z.string(),
  fuelType: z.string(),
  doors: z.number().int(),
  /** The demo plate that found it, if one did */
  demoPlate: z.string().optional(),
});

export type VehicleChoice = z.infer<typeof vehicleSchema>;

// The driver steps' answers (5.3, call 15). Stored shapes check types and stored values only; the
// rules that move with today or span steps are stepState()'s job (call 16), so an answer that turns
// invalid later is reopened, not lost.

const oneOf = <T extends string>(options: { value: T }[]) =>
  z.enum(options.map((o) => o.value) as [T, ...T[]]);
const fullLicence = z.enum(["full_uk", "full_eu"]);
const status = oneOf(statusOptions);

/** About you, plus the main driver's licence once the licence step is done */
const mainDriverSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  status,
  occupation: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  town: z.string(),
  licenceType: fullLicence.optional(),
  licenceDate: z.string().optional(),
  noClaimsYears: z.number().int().optional(),
});

const usageSchema = z.object({
  annualMileage: z.number().int(),
  currentMileage: z.number().int(),
  usage: oneOf(usageOptions),
  overnight: oneOf(overnightOptions),
});

const claimsSchema = z.object({
  any: z.boolean(),
  incidents: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      type: oneOf(incidentTypeOptions),
      fault: oneOf(faultOptions),
      costPounds: z.number().int(),
    }),
  ),
  confirmed: z.boolean(),
});

const namedDriversSchema = z.object({
  any: z.boolean(),
  drivers: z.array(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      dateOfBirth: z.string(),
      /** Kept in the tab only: drivers has no column for it (call 12) */
      relationship: oneOf(relationshipOptions),
      status,
      occupation: z.string(),
      licenceType: fullLicence,
      licenceDate: z.string(),
      anyClaims: z.boolean(),
      pastClaims: z.number().int(),
    }),
  ),
});

/** How the visitor would like to pay, picked on Your quote (5.4b, call 10). It never reaches the server. */
const paymentSchema = z.enum(["annual", "monthly"]);
export type Payment = z.infer<typeof paymentSchema>;

/** The cover chosen on Choose cover (5.5, decision 3); 5.6 saves it. The server checks the excess. */
const coverSchema = z.object({
  coverLevel: z.enum(coverLevels),
  voluntaryExcessPence: z.number().int(),
  addons: z.array(z.string()),
});
export type CoverChoice = z.infer<typeof coverSchema>;

/** Where Choose cover starts: Comprehensive, no voluntary excess, no extras */
export const DEFAULT_COVER: CoverChoice = {
  coverLevel: "comprehensive",
  voluntaryExcessPence: 0,
  addons: [],
};

/** Read one at a time: a part that fails is dropped alone (call 15) */
const partSchemas = {
  vehicle: vehicleSchema,
  mainDriver: mainDriverSchema,
  usage: usageSchema,
  claims: claimsSchema,
  namedDrivers: namedDriversSchema,
  payment: paymentSchema,
  cover: coverSchema,
};

const baseSchema = z.object({
  version: z.literal(1),
  /** Random, made here; `quote.started` is written once per id (plan P1) */
  journeyId: z.uuid(),
  postcode: z.string(),
  startedAt: z.iso.datetime(),
  /** The `quote.started` event has been sent for this journey */
  startRecorded: z.boolean(),
  /** The last plate typed that wasn't a demo plate, for screen 10; it never leaves the tab (call 9) */
  lastPlate: z.string().optional(),
});

export type MainDriver = z.infer<typeof mainDriverSchema>;

export type Journey = z.infer<typeof baseSchema> & {
  /** Car only (5.2) */
  vehicle?: VehicleChoice;
  /** Car only (5.3) */
  mainDriver?: MainDriver;
  usage?: z.infer<typeof usageSchema>;
  claims?: z.infer<typeof claimsSchema>;
  namedDrivers?: z.infer<typeof namedDriversSchema>;
  /** Kept in the tab for Choose cover and Buy (5.4b) */
  payment?: Payment;
  /** Car only, from Choose cover (5.5) */
  cover?: CoverChoice;
};

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

/**
 * A journey object read part by part (call 15): null when the base fails, and a part that fails is
 * dropped alone. The tab reads storage with it; the price server function (5.4) reads its input.
 */
export function parseJourney(json: unknown): Journey | null {
  const base = baseSchema.safeParse(json);
  if (!base.success) return null;
  const journey: Journey = base.data;
  const record = json as Record<string, unknown>;
  for (const [key, schema] of Object.entries(partSchemas)) {
    if (record[key] === undefined) continue;
    const part = schema.safeParse(record[key]);
    if (part.success) Object.assign(journey, { [key]: part.data });
  }
  return journey;
}

export function readJourney(
  product: BuyableProductId,
  storage: JourneyStorage | null = sessionStore(),
): Journey | null {
  try {
    const raw = storage?.getItem(journeyKey(product));
    if (!raw) return null;
    return parseJourney(JSON.parse(raw));
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

/** The car journey's confirmed car; null removes it. Nothing happens without a car journey. */
export function setVehicle(
  vehicle: VehicleChoice | null,
  storage: JourneyStorage | null = sessionStore(),
): void {
  const stored = readJourney("car", storage);
  if (!stored) return;
  const { vehicle: _old, ...rest } = stored;
  writeJourney("car", vehicle ? { ...rest, vehicle } : rest, storage);
}

export function setLastPlate(plate: string, storage: JourneyStorage | null = sessionStore()): void {
  const stored = readJourney("car", storage);
  if (stored) writeJourney("car", { ...stored, lastPlate: plate }, storage);
}

/** The pay choice from Your quote (5.4b, call 10). Nothing happens without a journey. */
export function setPayment(
  product: BuyableProductId,
  payment: Payment,
  storage: JourneyStorage | null = sessionStore(),
): void {
  const stored = readJourney(product, storage);
  if (stored) writeJourney(product, { ...stored, payment }, storage);
}

/** The car journey's cover choice (5.5, decision 3). Nothing happens without a car journey. */
export function setCover(
  cover: CoverChoice,
  storage: JourneyStorage | null = sessionStore(),
): void {
  const stored = readJourney("car", storage);
  if (stored) writeJourney("car", { ...stored, cover }, storage);
}

/** What each driver step saves (5.3) */
export interface StepAnswers {
  about: AboutYou;
  driving: LicenceAndUsage;
  claims: Claims;
  drivers: NamedDrivers;
}

/**
 * Saves one driver step's answers into the car journey. About you keeps any licence answers
 * already saved, and the licence step writes into the main driver and `usage`. Nothing happens
 * without a car journey, or for the licence step before About you.
 */
export function setStepAnswers<S extends keyof StepAnswers>(
  step: S,
  answers: StepAnswers[S],
  storage: JourneyStorage | null = sessionStore(),
): void {
  const stored = readJourney("car", storage);
  if (!stored) return;
  const next: Journey = { ...stored };
  if (step === "about") {
    const about = answers as AboutYou;
    const { licenceType, licenceDate, noClaimsYears } = stored.mainDriver ?? {};
    next.mainDriver = {
      ...about,
      ...(licenceType && { licenceType }),
      ...(licenceDate && { licenceDate }),
      ...(noClaimsYears !== undefined && { noClaimsYears }),
    };
  } else if (step === "driving") {
    if (!stored.mainDriver) return;
    const { licenceType, licenceDate, noClaimsYears, ...usage } = answers as LicenceAndUsage;
    next.mainDriver = { ...stored.mainDriver, licenceType, licenceDate, noClaimsYears };
    next.usage = usage;
  } else if (step === "claims") {
    next.claims = answers as Claims;
  } else {
    next.namedDrivers = answers as NamedDrivers;
  }
  writeJourney("car", next, storage);
}
