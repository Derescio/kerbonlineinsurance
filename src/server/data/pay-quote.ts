import { randomInt } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { monthlyPayment } from "#/features/rating/money";
import { Tables } from "#/features/rating/tables";
import type { Db } from "#/server/db/client";
import {
  bundles,
  customers,
  payments,
  policies,
  quoteItems,
  quotes,
  users,
} from "#/server/db/schema";
import { withSavepoint, type Tx } from "#/server/db/tx";

import { getRatingTables } from "./reference";

// The rows behind paying for a quote (5.6, decision 7). payForQuote in src/server/quote/ decides
// the order and the refusals; these lock, read and write inside its one transaction. Not reads
// for the permission suite: the caller has already checked who is asking.

const REFERENCE_TRIES = 5;
const UNIQUE_VIOLATION = "23505";

/**
 * The monthly payment the customer sees: the total with the credit charge of the item's own
 * rating version, never the active one, so a quote saved under v1 keeps v1's charge.
 */
export async function monthlyPaymentFor(
  db: Db | Tx,
  ratingVersionId: string,
  totalPence: number,
): Promise<number> {
  const tables = await getRatingTables(db, ratingVersionId);
  return monthlyPayment(totalPence, new Tables(tables).param("monthly_credit_charge_rate"));
}

/**
 * Expired at the instant it's valid until, the same in pay and in the reads (stateOf,
 * getQuoteForPayment), so a quote Saved quotes calls ready is one pay will take.
 */
export function hasExpired(validUntil: Date, now: Date): boolean {
  return validUntil <= now;
}

/**
 * The customer row, locked for this transaction, with the email. payForQuote locks the users row
 * first (lockUser), which is what a delete or a closure waits on (4.7: a purchase racing a delete).
 */
export async function lockCustomer(
  tx: Tx,
  customerId: string,
): Promise<{ id: string; firstName: string; email: string } | null> {
  const [row] = await tx
    .select({ id: customers.id, firstName: customers.firstName, email: users.email })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId))
    .for("update", { of: customers });
  return row ?? null;
}

/** The customer's own quote, locked, so a second payment waits and then sees it accepted */
export async function lockQuote(tx: Tx, quoteId: string, customerId: string) {
  const [row] = await tx
    .select({
      id: quotes.id,
      reference: quotes.reference,
      status: quotes.status,
      validUntil: quotes.validUntil,
      totalPence: quotes.totalPence,
    })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId)))
    .for("update");
  return row ?? null;
}

export interface PurchaseItem {
  id: string;
  product: string;
  ratingVersionId: string;
  voluntaryExcessPence: number;
  coverLevel: string;
  compulsoryExcessPence: number;
  /** The selected option plus the selected add-ons, before IPT */
  annualPremiumPence: number;
  car: { make: string; model: string; variant: string; registration: string | null } | null;
}

/** The quote's items with a selected option, in the order they were saved */
export async function purchaseItems(tx: Tx, quoteId: string): Promise<PurchaseItem[]> {
  const rows = await tx.query.quoteItems.findMany({
    columns: { id: true, product: true, ratingVersionId: true, voluntaryExcessPence: true },
    where: eq(quoteItems.quoteId, quoteId),
    orderBy: asc(quoteItems.id),
    with: {
      selectedOption: {
        columns: { coverLevel: true, compulsoryExcessPence: true, annualPremiumPence: true },
      },
      addons: { columns: { annualPricePence: true, selected: true } },
      vehicle: { columns: { make: true, model: true, variant: true, registration: true } },
    },
  });
  return rows.flatMap(({ selectedOption: option, addons, vehicle, ...item }) =>
    option
      ? [
          {
            ...item,
            coverLevel: option.coverLevel,
            compulsoryExcessPence: option.compulsoryExcessPence,
            annualPremiumPence:
              option.annualPremiumPence +
              addons.filter((a) => a.selected).reduce((sum, a) => sum + a.annualPricePence, 0),
            car: vehicle ?? null,
          },
        ]
      : [],
  );
}

export async function insertBundle(tx: Tx, customerId: string, quoteId: string): Promise<string> {
  const [row] = await tx
    .insert(bundles)
    .values({ customerId, quoteId })
    .returning({ id: bundles.id });
  return row!.id;
}

/** KRB-100000 to KRB-899999: below the seed's 9 range (4.9 call 19) */
const drawPolicyReference = () => `KRB-${randomInt(100_000, 900_000)}`;

function isReferenceClash(error: unknown): boolean {
  const pg = ((error as { cause?: unknown }).cause ?? error) as {
    code?: string;
    constraint?: string;
  };
  return pg.code === UNIQUE_VIOLATION && pg.constraint === "policies_reference_unique";
}

export type NewPolicy = Omit<typeof policies.$inferInsert, "id" | "reference">;

/**
 * Inserts a policy with a fresh reference. Each attempt is a savepoint, so a clash rolls back that
 * attempt alone and the next draw runs in the same transaction, as saveQuote() retries its own.
 */
export async function insertPolicy(
  tx: Tx,
  values: NewPolicy,
  deps: { drawReference?: () => string } = {},
): Promise<{ id: string; reference: string }> {
  const draw = deps.drawReference ?? drawPolicyReference;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withSavepoint(tx, async (sp) => {
        const [row] = await sp
          .insert(policies)
          .values({ ...values, reference: draw() })
          .returning({ id: policies.id, reference: policies.reference });
        return row!;
      });
    } catch (error) {
      if (attempt < REFERENCE_TRIES && isReferenceClash(error)) continue;
      throw error;
    }
  }
}

export async function insertPayments(
  tx: Tx,
  rows: (typeof payments.$inferInsert)[],
): Promise<void> {
  await tx.insert(payments).values(rows);
}

/** Accepted, with the plan and both confirmation times; each item starts on the chosen date */
export async function acceptQuote(
  tx: Tx,
  quoteId: string,
  { plan, at, startsOn }: { plan: "annual" | "monthly"; at: Date; startsOn: string },
): Promise<void> {
  await tx
    .update(quotes)
    .set({ status: "accepted", paymentPlan: plan, detailsConfirmedAt: at, coverAcknowledgedAt: at })
    .where(eq(quotes.id, quoteId));
  await tx.update(quoteItems).set({ startDate: startsOn }).where(eq(quoteItems.quoteId, quoteId));
}
