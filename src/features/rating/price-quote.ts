import type { CoverLevel, Product, ReasonCode } from "#/server/db/schema/values";

import {
  businessEligibility,
  carEligibility,
  coverAreaEligibility,
  homeEligibility,
  type Eligibility,
} from "./eligibility";
import { ipt } from "./money";
import { priceOptions, rateBusiness, rateCar, rateHome } from "./rate";
import { Tables } from "./tables";
import type {
  PricedAddon,
  PricedFactor,
  PricedOption,
  Rated,
  RatingData,
  RatingInputs,
} from "./types";

// priceQuote() (5.4): every item on a quote, rated by its own version's tables, checked for
// eligibility, then the bundle discount and IPT. Totals come from quoted items only, and every
// line is rounded once, so the breakdown sums to the total exactly (spec decisions 6 and 7).

export type QuoteItemRequest = RatingInputs & {
  tables: RatingData;
  coverLevel: CoverLevel;
  /** The add-ons chosen; any not offered to this risk are ignored */
  addons: string[];
};

export interface SelectedPrice {
  coverLevel: CoverLevel;
  premiumPence: number;
  addonsPence: number;
  discountPence: number;
  iptPence: number;
  feePence: number;
  totalPence: number;
}

export interface PricedItem {
  product: Product;
  ratingVersionId: string | null;
  outcome: "quoted" | "referred" | "declined";
  reasonCode: ReasonCode | null;
  driver: "main" | number | null;
  factors: PricedFactor[];
  options: PricedOption[];
  addons: PricedAddon[];
  /** The chosen cover's money; null unless the item is quoted */
  selected: SelectedPrice | null;
}

export interface PricedQuote {
  items: PricedItem[];
  /** Selected premiums and add-ons, before the discount */
  subtotalPence: number;
  bundleDiscountPence: number;
  feesPence: number;
  iptPence: number;
  totalPence: number;
  monthlyCreditChargeRate: number;
}

/** The discount on the combined premiums, shared in proportion; the largest takes what's left */
export function splitBundleDiscount(
  premiums: readonly { product: Product; premiumPence: number }[],
  rate: number,
): Map<Product, number> {
  const sum = premiums.reduce((total, p) => total + p.premiumPence, 0);
  const discount = Math.round(sum * rate);
  if (discount === 0) return new Map(premiums.map((p) => [p.product, 0]));
  const largest = premiums.reduce((a, b) => (b.premiumPence > a.premiumPence ? b : a));
  const shares = new Map<Product, number>();
  let given = 0;
  for (const p of premiums) {
    if (p === largest) continue;
    const share = Math.round((discount * p.premiumPence) / sum);
    shares.set(p.product, share);
    given += share;
  }
  shares.set(largest.product, discount - given);
  return shares;
}

interface Draft {
  request: QuoteItemRequest;
  tables: Tables;
  item: PricedItem;
  option: PricedOption | undefined;
  addons: PricedAddon[];
}

function rate(t: Tables, r: RatingInputs): Rated {
  switch (r.product) {
    case "car":
      return rateCar(t, r.inputs);
    case "home":
      return rateHome(t, r.inputs);
    case "business":
      return rateBusiness(t, r.inputs);
  }
}

function eligibility(t: Tables, r: RatingInputs): Eligibility {
  switch (r.product) {
    case "car":
      return carEligibility(t, r.inputs);
    case "home":
      return homeEligibility(t, r.inputs);
    case "business":
      return businessEligibility(t, r.inputs);
  }
}

/**
 * Every number in the inputs is finite and 0 or more. Some never pass through a band (a car's value,
 * a rebuild cost, a head count), so NaN would otherwise price as NaN and slip past every rule.
 */
function checkInputs(product: string, value: unknown, path = ""): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${product}: ${path} must be a finite number of 0 or more`);
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      checkInputs(
        product,
        child,
        Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key,
      );
    }
  }
}

function draft(request: QuoteItemRequest): Draft {
  checkInputs(request.product, request.inputs);
  const t = new Tables(request.tables);
  const base = {
    product: request.product,
    ratingVersionId: request.tables.id ?? null,
    selected: null,
  };
  // An area outside the UK market has no lookup rows, so it's declined before rating
  const area = coverAreaEligibility(request.inputs.postcodeArea);
  if (area) {
    return {
      request,
      tables: t,
      option: undefined,
      addons: [],
      item: {
        ...base,
        outcome: area.outcome,
        reasonCode: area.reason,
        driver: area.driver,
        factors: [],
        options: [],
        addons: [],
      },
    };
  }

  const rated = rate(t, request);
  const options = priceOptions(t, rated);
  const option = options.find((o) => o.coverLevel === request.coverLevel)!;
  let result = eligibility(t, request);
  if (!result && option.annualPremiumPence > t.param("max_premium_pence")) {
    result = { outcome: "referred", reason: "premium_above_max", driver: null };
  }
  return {
    request,
    tables: t,
    option,
    addons: rated.addons.filter((a) => request.addons.includes(a.addon)),
    item: {
      ...base,
      outcome: result?.outcome ?? "quoted",
      reasonCode: result?.reason ?? null,
      driver: result?.driver ?? null,
      factors: rated.factors,
      options,
      addons: rated.addons,
    },
  };
}

export function priceQuote(requests: readonly QuoteItemRequest[]): PricedQuote {
  const seen = new Set<Product>();
  for (const r of requests) {
    if (seen.has(r.product)) throw new Error(`priceQuote: two ${r.product} items`);
    seen.add(r.product);
  }

  const drafts = requests.map(draft);
  const quoted = drafts.filter((d) => d.item.outcome === "quoted");
  const car = quoted.find((d) => d.item.product === "car");
  const home = quoted.find((d) => d.item.product === "home");
  // One rate for a bundle: versions that disagree are a config error, not a choice
  if (
    car &&
    home &&
    car.tables.param("bundle_discount_rate") !== home.tables.param("bundle_discount_rate")
  ) {
    throw new Error("priceQuote: bundle_discount_rate differs between car and home");
  }
  const shares =
    car && home
      ? splitBundleDiscount(
          [car, home].map((d) => ({
            product: d.item.product,
            premiumPence: d.option!.annualPremiumPence,
          })),
          car.tables.param("bundle_discount_rate"),
        )
      : new Map<Product, number>();

  const totals = {
    subtotalPence: 0,
    bundleDiscountPence: 0,
    feesPence: 0,
    iptPence: 0,
    totalPence: 0,
  };
  for (const d of quoted) {
    const premiumPence = d.option!.annualPremiumPence;
    const addonsPence = d.addons.reduce((sum, a) => sum + a.annualPricePence, 0);
    const discountPence = shares.get(d.item.product) ?? 0;
    const iptPence = ipt(premiumPence - discountPence + addonsPence, d.tables.param("ipt_rate"));
    const feePence = d.tables.param("fee_pence");
    const totalPence = premiumPence - discountPence + addonsPence + iptPence + feePence;
    d.item.selected = {
      coverLevel: d.request.coverLevel,
      premiumPence,
      addonsPence,
      discountPence,
      iptPence,
      feePence,
      totalPence,
    };
    totals.subtotalPence += premiumPence + addonsPence;
    totals.bundleDiscountPence += discountPence;
    totals.feesPence += feePence;
    totals.iptPence += iptPence;
    totals.totalPence += totalPence;
  }

  return {
    items: drafts.map((d) => d.item),
    ...totals,
    // The first item's rate; every v1 has 0.10
    monthlyCreditChargeRate: drafts[0]?.tables.param("monthly_credit_charge_rate") ?? 0,
  };
}
