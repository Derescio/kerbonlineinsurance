import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { AuthzError } from "#/server/auth/errors";
import { quotes } from "#/server/db/schema";

import { defineRead } from "./define";
import { monthlyPaymentFor } from "./pay-quote";

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

export interface SavedQuoteCard {
  quoteId: string;
  reference: string;
  state: SavedQuoteState;
  car: CarSummary;
  coverLevel: string | null;
  annualTotalPence: number | null;
  monthlyPaymentPence: number | null;
  policyReference: string | null;
  postcode: string;
}

export interface PaymentSummary {
  quoteId: string;
  reference: string;
  status: string;
  expired: boolean;
  policyholder: { firstName: string; lastName: string };
  car: CarSummary;
  coverLevel: string | null;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  annualTotalPence: number;
  monthlyPaymentPence: number;
  startDate: string;
  addons: string[];
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
  }[];
}

const carColumns = { make: true, model: true, variant: true, registration: true } as const;

/** Accepted is bought; else a lapsed validity is expired; else referred is under review */
function stateOf(quote: { status: string; validUntil: Date }, now: Date): SavedQuoteState | null {
  if (quote.status === "accepted") return "bought";
  if (quote.status === "expired" || quote.validUntil < now) return "expired";
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
          columns: { ratingVersionId: true },
          with: {
            vehicle: { columns: carColumns },
            selectedOption: { columns: { coverLevel: true } },
          },
        },
      },
    });
    const now = new Date();
    const cards: SavedQuoteCard[] = [];
    for (const row of rows) {
      const state = stateOf(row, now);
      const item = row.items.find((i) => i.vehicle);
      if (!state || !item?.vehicle) continue;
      cards.push({
        quoteId: row.id,
        reference: row.reference,
        state,
        car: item.vehicle,
        coverLevel: item.selectedOption?.coverLevel ?? null,
        annualTotalPence: item.selectedOption ? row.totalPence : null,
        monthlyPaymentPence: item.selectedOption
          ? await monthlyPaymentFor(db, item.ratingVersionId, row.totalPence)
          : null,
        policyReference: row.policies[0]?.reference ?? null,
        postcode: row.postcode,
      });
    }
    return cards;
  },
);

export const getQuoteForPayment = defineRead(
  "signed_in",
  z.object({ quoteId: z.uuid() }),
  async (actor, { quoteId }, db): Promise<PaymentSummary> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const quote = await db.query.quotes.findFirst({
      columns: { id: true, reference: true, status: true, totalPence: true, validUntil: true },
      where: and(eq(quotes.id, quoteId), eq(quotes.customerId, actor.customerId)),
      with: {
        customer: { columns: { firstName: true, lastName: true } },
        items: {
          columns: { ratingVersionId: true, startDate: true, voluntaryExcessPence: true },
          with: {
            vehicle: { columns: carColumns },
            selectedOption: { columns: { coverLevel: true, compulsoryExcessPence: true } },
            addons: { columns: { addon: true, selected: true } },
          },
        },
      },
    });
    const item = quote?.items.find((i) => i.vehicle);
    if (!quote || !item?.vehicle) throw new AuthzError("NOT_FOUND");
    return {
      quoteId: quote.id,
      reference: quote.reference,
      status: quote.status,
      expired: quote.status === "expired" || quote.validUntil < new Date(),
      policyholder: quote.customer,
      car: item.vehicle,
      coverLevel: item.selectedOption?.coverLevel ?? null,
      compulsoryExcessPence: item.selectedOption?.compulsoryExcessPence ?? 0,
      voluntaryExcessPence: item.voluntaryExcessPence ?? 0,
      annualTotalPence: quote.totalPence,
      monthlyPaymentPence: await monthlyPaymentFor(db, item.ratingVersionId, quote.totalPence),
      startDate: item.startDate,
      addons: item.addons.filter((a) => a.selected).map((a) => a.addon),
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
          with: { quoteItem: { columns: {}, with: { vehicle: { columns: carColumns } } } },
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
      })),
    };
  },
);
