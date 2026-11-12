import type { PricedItem, PricedQuote } from "#/features/rating/price-quote";
import type {
  businesses,
  drivers,
  properties,
  quoteItemAddons,
  quoteItemFactors,
  quoteItemOptions,
  quoteItems,
  quotes,
  underwritingDecisions,
  vehicles,
} from "#/server/db/schema";

// The rows a priced quote is saved as (5.4, spec decision 2): one builder for saveQuote() and the
// seed (4.9), so both write the same shape. Pure: ids come from `newId`, times from `at`.

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];
type Detail<T extends { $inferInsert: unknown }> = Omit<
  Insert<T>,
  "quoteItemId" | "product" | "createdAt" | "updatedAt" | "id" | "isMain"
>;

export interface CarDetails {
  product: "car";
  vehicle: Detail<typeof vehicles>;
  /** The main driver first, then named drivers in the order entered */
  drivers: Detail<typeof drivers>[];
}
export interface HomeDetails {
  product: "home";
  property: Detail<typeof properties>;
}
export interface BusinessDetails {
  product: "business";
  business: Detail<typeof businesses>;
}
export type ItemDetails = CarDetails | HomeDetails | BusinessDetails;

export interface SaveItem {
  startDate: string;
  voluntaryExcessPence: number;
  details: ItemDetails;
}

export interface ItemRows {
  item: Insert<typeof quoteItems> & { id: string };
  options: (Insert<typeof quoteItemOptions> & { id: string })[];
  addons: Insert<typeof quoteItemAddons>[];
  factors: Insert<typeof quoteItemFactors>[];
  decision: Insert<typeof underwritingDecisions>;
  vehicles: Insert<typeof vehicles>[];
  drivers: Insert<typeof drivers>[];
  properties: Insert<typeof properties>[];
  businesses: Insert<typeof businesses>[];
}

export interface QuoteRowSet extends Omit<ItemRows, "item" | "decision"> {
  quote: Insert<typeof quotes> & { id: string };
  items: ItemRows["item"][];
  decisions: ItemRows["decision"][];
}

/** draft with no items; declined when nothing is left; referred while any item waits; else priced */
export function quoteStatus(outcomes: readonly PricedItem["outcome"][]) {
  if (outcomes.length === 0) return "draft";
  const live = outcomes.filter((o) => o !== "declined");
  if (live.length === 0) return "declined";
  return live.includes("referred") ? "referred" : "priced";
}

export function itemRows(
  priced: PricedItem,
  ctx: {
    quoteId: string;
    ratingVersionId: string;
    at: Date;
    newId: () => string;
  } & SaveItem,
): ItemRows {
  if (priced.product !== ctx.details.product) {
    throw new Error(`itemRows: ${priced.product} item with ${ctx.details.product} details`);
  }
  const id = ctx.newId();
  const at = ctx.at;
  const options = priced.options.map((o) => ({
    id: ctx.newId(),
    quoteItemId: id,
    coverLevel: o.coverLevel,
    coverMultiplier: o.coverMultiplier.toFixed(4),
    compulsoryExcessPence: o.compulsoryExcessPence,
    annualPremiumPence: o.annualPremiumPence,
    monthlyPremiumPence: o.monthlyPremiumPence,
    createdAt: at,
  }));
  // A declined item has no selection; a referred one keeps the tier asked for, for 6.11
  const selected =
    priced.outcome === "declined"
      ? null
      : (options.find((o) => o.coverLevel === priced.coverLevel)?.id ?? null);
  const live = priced.outcome !== "declined";

  const rows: ItemRows = {
    item: {
      id,
      quoteId: ctx.quoteId,
      product: priced.product,
      ratingVersionId: ctx.ratingVersionId,
      outcome: priced.outcome,
      reasonCode: priced.reasonCode,
      selectedOptionId: selected,
      voluntaryExcessPence: ctx.voluntaryExcessPence,
      startDate: ctx.startDate,
      createdAt: at,
      updatedAt: at,
    },
    options,
    addons: priced.addons.map((a) => ({
      id: ctx.newId(),
      quoteItemId: id,
      addon: a.addon,
      annualPricePence: a.annualPricePence,
      monthlyPricePence: a.monthlyPricePence,
      selected: live && priced.chosenAddons.includes(a.addon),
      createdAt: at,
    })),
    factors: priced.factors.map((f) => ({
      quoteItemId: id,
      factor: f.factor,
      inputValue: f.inputValue,
      multiplier: f.multiplier.toFixed(4),
      createdAt: at,
    })),
    decision: {
      quoteItemId: id,
      outcome: priced.outcome,
      reasonCode: priced.reasonCode,
      decidedBy: null,
      // For the 6.11 handler: which named driver a rule was about (spec decision 14)
      note: typeof priced.driver === "number" ? `named driver ${priced.driver}` : null,
      createdAt: at,
    },
    vehicles: [],
    drivers: [],
    properties: [],
    businesses: [],
  };

  const details = ctx.details;
  switch (details.product) {
    case "car":
      rows.vehicles.push({ ...details.vehicle, quoteItemId: id, createdAt: at });
      details.drivers.forEach((d, i) =>
        rows.drivers.push({
          ...d,
          id: ctx.newId(),
          quoteItemId: id,
          isMain: i === 0,
          createdAt: at,
        }),
      );
      break;
    case "home":
      rows.properties.push({ ...details.property, quoteItemId: id, createdAt: at });
      break;
    case "business":
      rows.businesses.push({ ...details.business, quoteItemId: id, createdAt: at });
      break;
  }
  return rows;
}

export function quoteRows(
  priced: PricedQuote,
  ctx: {
    quoteId: string;
    reference: string;
    customerId: string;
    postcode: string;
    at: Date;
    validUntil: Date;
    newId: () => string;
    items: readonly SaveItem[];
  },
): QuoteRowSet {
  if (ctx.items.length !== priced.items.length) {
    throw new Error("quoteRows: one SaveItem per priced item");
  }
  const set: QuoteRowSet = {
    quote: {
      id: ctx.quoteId,
      reference: ctx.reference,
      customerId: ctx.customerId,
      status: quoteStatus(priced.items.map((i) => i.outcome)),
      postcode: ctx.postcode,
      subtotalPence: priced.subtotalPence,
      bundleDiscountPence: priced.bundleDiscountPence,
      feesPence: priced.feesPence,
      iptPence: priced.iptPence,
      totalPence: priced.totalPence,
      validUntil: ctx.validUntil,
      createdAt: ctx.at,
      updatedAt: ctx.at,
    },
    items: [],
    options: [],
    addons: [],
    factors: [],
    decisions: [],
    vehicles: [],
    drivers: [],
    properties: [],
    businesses: [],
  };
  priced.items.forEach((item, i) => {
    if (!item.ratingVersionId)
      throw new Error("quoteRows: an item priced from a source, not a saved version");
    const rows = itemRows(item, {
      ...ctx.items[i]!,
      quoteId: ctx.quoteId,
      ratingVersionId: item.ratingVersionId,
      at: ctx.at,
      newId: ctx.newId,
    });
    set.items.push(rows.item);
    set.decisions.push(rows.decision);
    for (const key of [
      "options",
      "addons",
      "factors",
      "vehicles",
      "drivers",
      "properties",
      "businesses",
    ] as const) {
      (set[key] as unknown[]).push(...rows[key]);
    }
  });
  return set;
}
