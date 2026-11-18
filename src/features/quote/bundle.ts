import { monthlyPayment } from "#/features/rating/money";
import { quoteTotals } from "#/features/rating/price-quote";

import { coverLine, type CoverPrices } from "./cover";
import type { CoverChoice, Journey } from "./journey-store";
import type { EmploymentStatus } from "./occupation";

// The car + home bundle in the tab (5.7b). The home journey carries a mark naming the car journey
// it's bought with; the bundle is on only while that car journey is still the tab's and has a
// chosen cover (decision 1). Its money is the engine's own quoteTotals() over both choices, so
// screen 22's panel shows what the save stores (decision 4).

export function bundleLive(car: Journey | null, home: Journey | null): boolean {
  return Boolean(car?.cover && home?.bundle && home.bundle.carJourneyId === car.journeyId);
}

export interface BundleMoney {
  car: { totalPence: number; discountPence: number };
  home: { totalPence: number; discountPence: number };
  /** The bundle discount on the combined premiums */
  savingPence: number;
  /** The annual total for both, with IPT */
  totalPence: number;
  monthlyPaymentPence: number;
}

/** Both choices together, or null when either tier can't be chosen */
export function composeBundle(
  car: { prices: CoverPrices; cover: CoverChoice },
  home: { prices: CoverPrices; cover: CoverChoice },
): BundleMoney | null {
  // One subscription for both: versions that disagree are a config error, not a choice
  if (car.prices.monthlyCreditChargeRate !== home.prices.monthlyCreditChargeRate) {
    throw new Error("composeBundle: monthly_credit_charge_rate differs between car and home");
  }
  const carLine = coverLine("car", car.prices, car.cover.coverLevel, car.cover.addons);
  const homeLine = coverLine("home", home.prices, home.cover.coverLevel, home.cover.addons);
  if (!carLine || !homeLine) return null;
  const totals = quoteTotals([carLine, homeLine]);
  const c = totals.lines.get("car")!;
  const h = totals.lines.get("home")!;
  return {
    car: { totalPence: c.totalPence, discountPence: c.discountPence },
    home: { totalPence: h.totalPence, discountPence: h.discountPence },
    savingPence: totals.bundleDiscountPence,
    totalPence: totals.totalPence,
    monthlyPaymentPence: monthlyPayment(totals.totalPence, car.prices.monthlyCreditChargeRate),
  };
}

export interface Person {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

/** The policyholder with employment, which home asks from 5.7c; older home answers lack it */
export interface PrefilledPerson extends Person {
  status: EmploymentStatus | undefined;
  occupation: string | undefined;
}

/** The other product's policyholder, to start an empty About you from (decision 3; 5.7c) */
export function prefillAbout(from: Journey | null): PrefilledPerson | undefined {
  const person = from?.mainDriver ?? from?.homeAbout;
  if (!person) return undefined;
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    dateOfBirth: person.dateOfBirth,
    status: person.status,
    occupation: person.occupation,
  };
}

export interface SharedAddress {
  line1: string;
  line2?: string;
  town: string;
}

/**
 * The other product's address, to start an empty one from (decision 3; Damion, 17 Nov 2026):
 * car's About you address, or the home's insured address
 */
export function prefillAddress(from: Journey | null): SharedAddress | undefined {
  const main = from?.mainDriver;
  if (main?.addressLine1) {
    return { line1: main.addressLine1, line2: main.addressLine2, town: main.town };
  }
  const home = from?.property?.address;
  return home ? { line1: home.line1, line2: home.line2, town: home.town } : undefined;
}

const name = (s: string) => s.trim().toLowerCase();

/** One policyholder per bundle (decision 6): names trimmed and case-blind, dates exactly */
export function samePerson(a: Person, b: Person): boolean {
  return (
    name(a.firstName) === name(b.firstName) &&
    name(a.lastName) === name(b.lastName) &&
    a.dateOfBirth === b.dateOfBirth
  );
}
