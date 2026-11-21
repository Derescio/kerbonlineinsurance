import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { Tables } from "#/features/rating/tables";
import { AuthzError } from "#/server/auth/errors";
import { customers, policies, quotes } from "#/server/db/schema";

import { defineRead } from "./define";
import { hasExpired, monthlyPaymentFor } from "./pay-quote";
import { getRatingTables } from "./reference";

// The signed-in customer's own saved quotes, the pay page and the purchase (5.6, decisions 6, 9
// and 10). Every query filters by actor.customerId, so someone else's quote is indistinguishable
// from a missing one. The monthly payment comes from the item's own rating version, never the
// active one, so a quote saved under v1 keeps v1's credit charge after v2 goes live.

export type SavedQuoteState = "ready" | "review" | "bought" | "expired";

export interface CarSummary {
  make: string;
  model: string;
  variant: string;
  registration: string | null;
}

/** The insured home, as the quote pages show it (5.7, decision 11) */
export interface PropertySummary {
  addressLine1: string;
  town: string;
  postcode: string;
  propertyType: string;
  bedrooms: number;
}

/** One item on a quote: a car or a home, with its chosen cover (5.7b lists both on a bundle) */
export interface QuoteItemSummary {
  product: "car" | "home";
  /** One of car and home is set (5.7) */
  car: CarSummary | null;
  home: PropertySummary | null;
  coverLevel: string | null;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  addons: string[];
}

export interface SavedQuoteCard {
  quoteId: string;
  reference: string;
  state: SavedQuoteState;
  /** Car first; a bundle has a car and a home (5.7b) */
  items: QuoteItemSummary[];
  annualTotalPence: number | null;
  monthlyPaymentPence: number | null;
  /** A policy per item once bought */
  policyReferences: string[];
  postcode: string;
}

export interface PaymentSummary {
  quoteId: string;
  reference: string;
  status: string;
  expired: boolean;
  policyholder: { firstName: string; lastName: string };
  /** Car first; a bundle has a car and a home (5.7b) */
  items: QuoteItemSummary[];
  /** The bundle discount on the combined premiums; 0 for one item with no saving */
  bundleSavingPence: number;
  /** The product already held, when this one-item quote's saving comes from it (6.1b) */
  savingBecause: "car" | "home" | null;
  /** That version's bundle_discount_rate, with savingBecause */
  savingRate: number | null;
  annualTotalPence: number;
  monthlyPaymentPence: number;
  startDate: string;
}

export interface Purchase {
  firstName: string;
  email: string;
  plan: string;
  card: { brand: string; last4: string };
  firstPaymentPence: number;
  monthlyPaymentPence: number | null;
  policies: {
    reference: string;
    product: string;
    coverLevel: string;
    startsOn: string;
    endsOn: string;
    compulsoryExcessPence: number;
    voluntaryExcessPence: number;
    car: CarSummary | null;
    home: PropertySummary | null;
  }[];
}

const carColumns = { make: true, model: true, variant: true, registration: true } as const;
const homeColumns = {
  addressLine1: true,
  town: true,
  postcode: true,
  propertyType: true,
  bedrooms: true,
} as const;

interface ItemRow {
  voluntaryExcessPence: number | null;
  vehicle: CarSummary | null;
  property: PropertySummary | null;
  selectedOption: { coverLevel: string; compulsoryExcessPence: number } | null;
  addons: { addon: string; selected: boolean }[];
}

/** A quote's car and home items, car first; an item with neither isn't shown */
function itemSummaries(items: readonly ItemRow[]): QuoteItemSummary[] {
  return items
    .filter((i) => i.vehicle ?? i.property)
    .map((i) => ({
      product: i.vehicle ? ("car" as const) : ("home" as const),
      car: i.vehicle ?? null,
      home: i.property ?? null,
      coverLevel: i.selectedOption?.coverLevel ?? null,
      compulsoryExcessPence: i.selectedOption?.compulsoryExcessPence ?? 0,
      voluntaryExcessPence: i.voluntaryExcessPence ?? 0,
      addons: i.addons.filter((a) => a.selected).map((a) => a.addon),
    }))
    .sort((a, b) => (a.product === b.product ? 0 : a.product === "car" ? -1 : 1));
}

/** Accepted is bought; else a lapsed validity is expired; else referred is under review */
function stateOf(quote: { status: string; validUntil: Date }, now: Date): SavedQuoteState | null {
  if (quote.status === "accepted") return "bought";
  if (quote.status === "expired" || hasExpired(quote.validUntil, now)) return "expired";
  if (quote.status === "referred") return "review";
  if (quote.status === "priced") return "ready";
  return null;
}

// A declined or draft quote isn't listed (decision 10)
const LISTED = ["priced", "referred", "accepted", "expired"];

export const listMyQuotes = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<SavedQuoteCard[]> => {
    if (!actor.customerId) return [];
    const rows = await db.query.quotes.findMany({
      columns: {
        id: true,
        reference: true,
        status: true,
        postcode: true,
        totalPence: true,
        validUntil: true,
      },
      where: and(eq(quotes.customerId, actor.customerId), inArray(quotes.status, LISTED)),
      // Saved in one request share a time; the v7 id breaks the tie
      orderBy: [desc(quotes.createdAt), desc(quotes.id)],
      with: {
        policies: { columns: { reference: true } },
        items: {
          columns: { ratingVersionId: true, voluntaryExcessPence: true },
          with: {
            vehicle: { columns: carColumns },
            property: { columns: homeColumns },
            selectedOption: { columns: { coverLevel: true, compulsoryExcessPence: true } },
            addons: { columns: { addon: true, selected: true } },
          },
        },
      },
    });
    const now = new Date();
    const cards: SavedQuoteCard[] = [];
    for (const row of rows) {
      const state = stateOf(row, now);
      // Every car or home item: a bundle shows both (5.7b)
      const items = itemSummaries(row.items);
      if (!state || !items.length) continue;
      const chosen = items.every((i) => i.coverLevel !== null);
      cards.push({
        quoteId: row.id,
        reference: row.reference,
        state,
        items,
        annualTotalPence: chosen ? row.totalPence : null,
        monthlyPaymentPence: chosen
          ? await monthlyPaymentFor(
              db,
              row.items.map((i) => i.ratingVersionId),
              row.totalPence,
            )
          : null,
        policyReferences: row.policies.map((p) => p.reference),
        postcode: row.postcode,
      });
    }
    return cards;
  },
);

/** The eyebrow on Your saved quotes: the signed-in customer's own name, or null before a first save */
export const getMyCustomerName = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<{ firstName: string; lastName: string } | null> => {
    if (!actor.customerId) return null;
    const row = await db.query.customers.findFirst({
      columns: { firstName: true, lastName: true },
      where: eq(customers.id, actor.customerId),
    });
    return row ?? null;
  },
);

export const getQuoteForPayment = defineRead(
  "signed_in",
  z.object({ quoteId: z.uuid() }),
  async (actor, { quoteId }, db): Promise<PaymentSummary> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const quote = await db.query.quotes.findFirst({
      columns: {
        id: true,
        reference: true,
        status: true,
        totalPence: true,
        bundleDiscountPence: true,
        bundlePolicyId: true,
        validUntil: true,
      },
      where: and(eq(quotes.id, quoteId), eq(quotes.customerId, actor.customerId)),
      with: {
        customer: { columns: { firstName: true, lastName: true } },
        items: {
          columns: { ratingVersionId: true, startDate: true, voluntaryExcessPence: true },
          with: {
            vehicle: { columns: carColumns },
            property: { columns: homeColumns },
            selectedOption: { columns: { coverLevel: true, compulsoryExcessPence: true } },
            addons: { columns: { addon: true, selected: true } },
          },
        },
      },
    });
    const items = quote ? itemSummaries(quote.items) : [];
    if (!quote || !items.length) throw new AuthzError("NOT_FOUND");
    const earning = quote.bundlePolicyId
      ? await db.query.policies.findFirst({
          columns: { product: true },
          where: and(
            eq(policies.id, quote.bundlePolicyId),
            eq(policies.customerId, actor.customerId),
          ),
        })
      : null;
    const savingBecause =
      items.length === 1 && (earning?.product === "car" || earning?.product === "home")
        ? earning.product
        : null;
    const savingRate = savingBecause
      ? new Tables(await getRatingTables(db, quote.items[0]!.ratingVersionId)).param(
          "bundle_discount_rate",
        )
      : null;
    return {
      quoteId: quote.id,
      reference: quote.reference,
      status: quote.status,
      expired: quote.status === "expired" || hasExpired(quote.validUntil, new Date()),
      policyholder: quote.customer,
      items,
      bundleSavingPence: quote.bundleDiscountPence ?? 0,
      savingBecause,
      savingRate,
      annualTotalPence: quote.totalPence,
      monthlyPaymentPence: await monthlyPaymentFor(
        db,
        quote.items.map((i) => i.ratingVersionId),
        quote.totalPence,
      ),
      // Every item starts on the one date Confirm and pay sets (5.6, decision 8)
      startDate: quote.items[0]!.startDate,
    };
  },
);

export const getPurchase = defineRead(
  "signed_in",
  z.object({ quoteId: z.uuid() }),
  async (actor, { quoteId }, db): Promise<Purchase> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const quote = await db.query.quotes.findFirst({
      columns: { id: true },
      where: and(
        eq(quotes.id, quoteId),
        eq(quotes.customerId, actor.customerId),
        eq(quotes.status, "accepted"),
      ),
      with: {
        customer: { columns: { firstName: true }, with: { user: { columns: { email: true } } } },
        payments: {
          columns: {
            plan: true,
            amountPence: true,
            cardBrand: true,
            cardLast4: true,
          },
          orderBy: (payment, { asc }) => [asc(payment.instalmentNumber)],
        },
        policies: {
          columns: {
            reference: true,
            product: true,
            coverLevel: true,
            startsOn: true,
            endsOn: true,
            compulsoryExcessPence: true,
            voluntaryExcessPence: true,
          },
          orderBy: (policy, { asc }) => [asc(policy.createdAt)],
          with: {
            quoteItem: {
              columns: {},
              with: { vehicle: { columns: carColumns }, property: { columns: homeColumns } },
            },
          },
        },
      },
    });
    const [first, second] = quote?.payments ?? [];
    if (!quote || !first) throw new AuthzError("NOT_FOUND");
    return {
      firstName: quote.customer.firstName,
      email: quote.customer.user.email,
      plan: first.plan,
      card: { brand: first.cardBrand, last4: first.cardLast4 },
      firstPaymentPence: first.amountPence,
      // Instalments 2 to 12 are the same amount; an annual plan has only the first
      monthlyPaymentPence: first.plan === "monthly" ? (second?.amountPence ?? null) : null,
      policies: quote.policies.map(({ quoteItem, ...policy }) => ({
        ...policy,
        car: quoteItem.vehicle ?? null,
        home: quoteItem.property ?? null,
      })),
    };
  },
);
