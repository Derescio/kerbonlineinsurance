import { ipt, monthlyPayment, representativeApr } from "#/features/rating/money";
import { quoteTotals, type TotalsLine } from "#/features/rating/price-quote";
import type { CoverLevel, Product } from "#/server/db/schema/values";

import type { CoverChoice } from "./journey-store";
import type { BuyableProductId } from "./products";

// Choose cover's money and copy (5.5, decisions 4 to 8 and 13). The server prices every tier once
// per voluntary excess; the browser adds up any choice of tier and extras with the engine's own
// quoteTotals(), so the figures match what 5.6 saves.

/** The amounts offered: the lower edges of car v1's voluntary_excess bands (decision 4) */
export const VOLUNTARY_EXCESS_PENCE = [0, 10_000, 25_000, 50_000, 75_000, 100_000] as const;

export function isOfferedExcess(pence: unknown): pence is number {
  return (VOLUNTARY_EXCESS_PENCE as readonly unknown[]).includes(pence);
}

export interface TierPrice {
  coverLevel: CoverLevel;
  /** A tier alone can be referred: its premium went over the version's maximum (decision 6) */
  outcome: "quoted" | "referred";
  /** Before IPT; null when referred */
  premiumPence: number | null;
  /** The tier's, plus the young-driver excess when it applies */
  compulsoryExcessPence: number;
}

/** What the server sends for one voluntary excess: enough to compose any tier and extras */
export interface CoverPrices {
  voluntaryExcessPence: number;
  levels: TierPrice[];
  /** Each add-on's annual price before IPT */
  addons: { addon: string; annualPricePence: number }[];
  iptRate: number;
  feePence: number;
  monthlyCreditChargeRate: number;
  bundleDiscountRate: number;
}

export interface ComposedCover {
  coverLevel: CoverLevel;
  premiumPence: number;
  addons: { addon: string; annualPricePence: number }[];
  feePence: number;
  iptPence: number;
  /** The annual total with IPT */
  totalPence: number;
  monthlyPaymentPence: number;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
}

/** One product's line for quoteTotals(), or null when that tier can't be chosen */
export function coverLine(
  product: Product,
  prices: CoverPrices,
  coverLevel: CoverLevel,
  chosenAddons: readonly string[],
): TotalsLine | null {
  const tier = prices.levels.find((t) => t.coverLevel === coverLevel);
  if (!tier || tier.outcome !== "quoted" || tier.premiumPence === null) return null;
  return {
    product,
    premiumPence: tier.premiumPence,
    addonsPence: prices.addons
      .filter((a) => chosenAddons.includes(a.addon))
      .reduce((sum, a) => sum + a.annualPricePence, 0),
    iptRate: prices.iptRate,
    feePence: prices.feePence,
    bundleRate: prices.bundleDiscountRate,
  };
}

/** A tier with the chosen extras, or null when that tier can't be chosen */
export function composeCover(
  prices: CoverPrices,
  coverLevel: CoverLevel,
  chosenAddons: readonly string[],
  /** The multi-policy rate, when a signed-in customer holds the other product (6.1b) */
  savingRate?: number,
): ComposedCover | null {
  const tier = prices.levels.find((t) => t.coverLevel === coverLevel);
  const priced = coverLine("car", prices, coverLevel, chosenAddons);
  if (!tier || !priced) return null;
  const addons = prices.addons.filter((a) => chosenAddons.includes(a.addon));
  const line = quoteTotals([priced], savingRate).lines.get("car")!;
  return {
    coverLevel,
    premiumPence: priced.premiumPence,
    addons,
    feePence: line.feePence,
    iptPence: line.iptPence,
    totalPence: line.totalPence,
    monthlyPaymentPence: monthlyPayment(line.totalPence, prices.monthlyCreditChargeRate),
    compulsoryExcessPence: tier.compulsoryExcessPence,
    voluntaryExcessPence: prices.voluntaryExcessPence,
  };
}

/**
 * The choice as it can be priced: a tier that's referred at this excess goes back to Comprehensive
 * (the quote's own tier, quoted whenever the quote is), and an add-on not offered is dropped.
 */
export function usableCover(prices: CoverPrices, cover: CoverChoice): CoverChoice {
  const tier = prices.levels.find((t) => t.coverLevel === cover.coverLevel);
  const offered = new Set(prices.addons.map((a) => a.addon));
  return {
    coverLevel: tier?.outcome === "quoted" ? cover.coverLevel : "comprehensive",
    voluntaryExcessPence: cover.voluntaryExcessPence,
    addons: cover.addons.filter((a) => offered.has(a)),
  };
}

/** An add-on's own price with IPT, as the checkbox shows it (decision 5) */
export function addonWithIpt(prices: CoverPrices, annualPricePence: number) {
  const annual = annualPricePence + ipt(annualPricePence, prices.iptRate);
  return {
    annualPence: annual,
    monthlyPence: monthlyPayment(annual, prices.monthlyCreditChargeRate),
  };
}

/** The monthly lines of the breakdown (decisions 7 and 8) */
export function monthlyTerms(composed: ComposedCover) {
  const totalPayablePence = composed.monthlyPaymentPence * 12;
  return {
    paymentPence: composed.monthlyPaymentPence,
    totalPayablePence,
    costPence: totalPayablePence - composed.totalPence,
    apr: representativeApr(composed.totalPence, composed.monthlyPaymentPence),
  };
}

// Product copy, as screen 13 draws it (decision 13)

export const FEATURES = [
  { key: "damage", label: "Damage to your car" },
  { key: "thirdParty", label: "Third-party damage" },
  { key: "fireTheft", label: "Fire and theft" },
  { key: "courtesy", label: "Courtesy car" },
] as const;

type Feature = (typeof FEATURES)[number]["key"];

export const TIERS: Record<
  CoverLevel,
  { name: string; description: string; includes: Record<Feature, boolean> }
> = {
  essential: {
    name: "Essential",
    description: "Core protection · Lowest price",
    includes: { damage: false, thirdParty: true, fireTheft: false, courtesy: false },
  },
  comprehensive: {
    name: "Comprehensive",
    description: "Covers your car too",
    includes: { damage: true, thirdParty: true, fireTheft: true, courtesy: true },
  },
  plus: {
    name: "Plus",
    description: "More help included · Lower excess",
    includes: { damage: true, thirdParty: true, fireTheft: true, courtesy: true },
  },
};

// Home's levels, as the comparison table and cards show them (5.7, decision 11)
export const HOME_FEATURES = [
  { key: "buildings", label: "Buildings cover" },
  { key: "contents", label: "Contents cover" },
  { key: "accidental", label: "Accidental damage" },
  { key: "accommodation", label: "Alternative accommodation" },
] as const;

type HomeFeature = (typeof HOME_FEATURES)[number]["key"];

export const HOME_TIERS: Record<
  CoverLevel,
  { name: string; description: string; includes: Record<HomeFeature, boolean> }
> = {
  essential: {
    name: "Essential",
    description: "Core protection · Lowest price",
    includes: { buildings: true, contents: true, accidental: false, accommodation: true },
  },
  comprehensive: {
    name: "Comprehensive",
    description: "Adds accidental damage",
    includes: { buildings: true, contents: true, accidental: true, accommodation: true },
  },
  plus: {
    name: "Plus",
    description: "More help included · Lower excess",
    includes: { buildings: true, contents: true, accidental: true, accommodation: true },
  },
};

export interface CoverCopy {
  features: readonly { key: string; label: string }[];
  tiers: Record<
    CoverLevel,
    { name: string; description: string; includes: Record<string, boolean> }
  >;
}

/** The comparison rows and level copy for a product (5.7: home's own) */
export function coverCopy(product: BuyableProductId): CoverCopy {
  return product === "home"
    ? { features: HOME_FEATURES, tiers: HOME_TIERS }
    : { features: FEATURES, tiers: TIERS };
}

const ADDONS: Record<string, { label: string; description: string }> = {
  breakdown_uk: { label: "Breakdown cover", description: "24/7 roadside help anywhere in the UK" },
  motor_legal: {
    label: "Motor legal protection",
    description: "Legal costs up to £100,000 after an accident that wasn’t your fault",
  },
  home_emergency: {
    label: "Home emergency cover",
    description: "24/7 help with boiler, plumbing and electrical emergencies",
  },
  legal_expenses: {
    label: "Family legal protection",
    description: "Legal costs up to £50,000 for disputes about your home",
  },
  personal_possessions: {
    label: "Personal possessions",
    description: "Your belongings covered away from home, up to £2,500",
  },
};

/** An add-on the copy doesn't know shows its name, so nothing is hidden (decision 5) */
export function addonCopy(addon: string): { label: string; description?: string } {
  return ADDONS[addon] ?? { label: addon };
}
