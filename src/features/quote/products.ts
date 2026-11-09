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
export type BuyableProductId = "car" | "home";
export const buyableProducts: readonly BuyableProductId[] = ["car", "home"];

export function isProductId(value: unknown): value is ProductId {
  return typeof value === "string" && (productIds as readonly string[]).includes(value);
}

export function isBuyable(id: ProductId): id is BuyableProductId {
  return (buyableProducts as readonly string[]).includes(id);
}

/** The type picker's cards, in the order screen 01 draws them (Figma 222:6702). */
export const quoteTypes: readonly { id: ProductId; label: string }[] = [
  { id: "car", label: "Car" },
  { id: "home", label: "Home" },
  { id: "landlord", label: "Landlord" },
  { id: "pet", label: "Pet" },
  { id: "condo", label: "Condo" },
  { id: "business", label: "Business" },
  { id: "tenant", label: "Tenant" },
];
