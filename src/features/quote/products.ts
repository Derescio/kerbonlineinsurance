import { quoteHref } from "#/components/site/links";

/** Every insurance type Kerb lists. The landing accordion links each one to the quote start. */
export const productIds = [
  "car",
  "home",
  "condo",
  "tenant",
  "landlord",
  "pet",
  "business",
] as const;

export type ProductId = (typeof productIds)[number];

/** The types with a quote journey in Phase 5; the rest show "coming soon" on /quote. */
export const buyableProducts: readonly ProductId[] = ["car", "home"];

export function isProductId(value: unknown): value is ProductId {
  return typeof value === "string" && (productIds as readonly string[]).includes(value);
}

/** "/quote?type=home": the quote start with the type picked, so the user only adds a postcode. */
export function quoteHrefFor(type: ProductId): string {
  return `${quoteHref}?type=${type}`;
}
