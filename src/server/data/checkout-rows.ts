import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { getDb, type Db } from "#/server/db/client";
import {
  checkoutSessions,
  customers,
  payments,
  policies,
  quotes,
  stripeEvents,
  users,
} from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

// The rows behind Stripe payments (5.6b): checkout sessions, the event gate, the Stripe ids on
// customers and payments, and the policy status moves. Plain functions, not defineRead: the checkout
// server function, the webhook and the daily lapse job call them with the access already decided,
// so the permission suite skips this module (as it does job-rows.ts). Each takes the Db or the Tx
// of the transaction it joins.

export type CheckoutSessionRow = typeof checkoutSessions.$inferSelect;
export type CheckoutSessionStatus = CheckoutSessionRow["status"];
export type PaymentRow = typeof payments.$inferSelect;
export type PolicyRow = typeof policies.$inferSelect;

export type NewCheckoutSession = Pick<
  typeof checkoutSessions.$inferInsert,
  | "quoteId"
  | "customerId"
  | "stripeSessionId"
  | "plan"
  | "startsOn"
  | "detailsConfirmedAt"
  | "coverAcknowledgedAt"
  | "amountPence"
> & { status?: CheckoutSessionStatus };

/** Records a Checkout Session just created at Stripe, with the answers it was made for */
export async function insertCheckoutSession(
  tx: Db | Tx,
  row: NewCheckoutSession,
): Promise<{ id: string }> {
  const [created] = await tx.insert(checkoutSessions).values(row).returning({
    id: checkoutSessions.id,
  });
  return created!;
}

/** The quote's open session (there's at most one), or null */
export async function openCheckoutFor(
  tx: Db | Tx,
  quoteId: string,
): Promise<{ id: string; stripeSessionId: string } | null> {
  const [row] = await tx
    .select({ id: checkoutSessions.id, stripeSessionId: checkoutSessions.stripeSessionId })
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.quoteId, quoteId), eq(checkoutSessions.status, "open")));
  return row ?? null;
}

/** The app's database, for fulfilment's own transactions (it runs outside defineWrite) */
export function checkoutDb(): Db {
  return getDb();
}

/**
 * Who a session's checkout is for and until when its quote was valid, read without a lock, so
 * fulfilment can lock the users row before the session's (the order startCheckout takes them in)
 */
export async function checkoutContext(
  tx: Db | Tx,
  stripeSessionId: string,
): Promise<{ userId: string; quoteValidUntil: Date } | null> {
  const [row] = await tx
    .select({ userId: customers.userId, quoteValidUntil: quotes.validUntil })
    .from(checkoutSessions)
    .innerJoin(customers, eq(customers.id, checkoutSessions.customerId))
    .innerJoin(quotes, eq(quotes.id, checkoutSessions.quoteId))
    .where(eq(checkoutSessions.stripeSessionId, stripeSessionId));
  if (!row?.userId) return null;
  return { userId: row.userId, quoteValidUntil: row.quoteValidUntil };
}

/** Is the session one of this customer's, for this quote? (the return page's ownership check) */
export async function isOwnCheckout(
  tx: Db | Tx,
  input: { customerId: string; quoteId: string; stripeSessionId: string },
): Promise<boolean> {
  const [row] = await tx
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.stripeSessionId, input.stripeSessionId),
        eq(checkoutSessions.quoteId, input.quoteId),
        eq(checkoutSessions.customerId, input.customerId),
      ),
    );
  return Boolean(row);
}

/** The session row `FOR UPDATE`, so the return page and the webhook can't fulfil it together */
export async function lockCheckoutBySessionId(
  tx: Db | Tx,
  stripeSessionId: string,
): Promise<CheckoutSessionRow | null> {
  const [row] = await tx
    .select()
    .from(checkoutSessions)
    .where(eq(checkoutSessions.stripeSessionId, stripeSessionId))
    .for("update");
  return row ?? null;
}

/**
 * Moves a session to a new status at `at` (default now). `completed` stamps `fulfilled_at` and a
 * later move never clears it. `at` must differ from the stored `updated_at`: the set_updated_at
 * trigger replaces an unchanged value with the database clock.
 */
export async function markCheckout(
  tx: Db | Tx,
  id: string,
  status: CheckoutSessionStatus,
  at: Date = new Date(),
): Promise<void> {
  await tx
    .update(checkoutSessions)
    .set({ status, updatedAt: at, ...(status === "completed" ? { fulfilledAt: at } : {}) })
    .where(eq(checkoutSessions.id, id));
}

/** The gate that makes a webhook delivered twice act once: true when the event id is new */
export async function recordStripeEvent(
  tx: Db | Tx,
  eventId: string,
  type: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx
    .insert(stripeEvents)
    .values({ eventId, type, receivedAt: at })
    .onConflictDoNothing({ target: stripeEvents.eventId })
    .returning({ eventId: stripeEvents.eventId });
  return rows.length > 0;
}

export async function setStripeCustomerId(
  tx: Db | Tx,
  customerId: string,
  stripeCustomerId: string,
): Promise<void> {
  await tx.update(customers).set({ stripeCustomerId }).where(eq(customers.id, customerId));
}

/** A subscription's instalment rows, in instalment order */
export async function paymentsForSubscription(
  tx: Db | Tx,
  subscriptionId: string,
): Promise<PaymentRow[]> {
  return tx
    .select()
    .from(payments)
    .where(eq(payments.stripeSubscriptionId, subscriptionId))
    .orderBy(asc(payments.instalmentNumber));
}

/**
 * A subscription's instalment rows, in instalment order, locked `FOR UPDATE`: two webhook events
 * about one subscription (a failure and the retry that paid) then apply one after the other
 */
export async function lockPaymentsForSubscription(
  tx: Tx,
  subscriptionId: string,
): Promise<PaymentRow[]> {
  return tx
    .select()
    .from(payments)
    .where(eq(payments.stripeSubscriptionId, subscriptionId))
    .orderBy(asc(payments.instalmentNumber))
    .for("update");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does this database know the quote a Stripe object was made for: the quote itself, or a checkout
 * session for it? False for anything that isn't a uuid (another database's or a made-up id).
 */
export async function isKnownQuote(tx: Db | Tx, quoteId: string): Promise<boolean> {
  if (!UUID.test(quoteId)) return false;
  const [quote] = await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, quoteId));
  if (quote) return true;
  const [session] = await tx
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(eq(checkoutSessions.quoteId, quoteId))
    .limit(1);
  return Boolean(session);
}

/** Who to email about a customer's payments: first name and sign-in email; null with no user */
export async function customerContact(
  tx: Db | Tx,
  customerId: string,
): Promise<{ firstName: string; email: string } | null> {
  const [row] = await tx
    .select({ firstName: customers.firstName, email: users.email })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  return row ?? null;
}

/** Every policy on the quote the subscription pays for (a bundle has more than one) */
export async function policiesForSubscription(
  tx: Db | Tx,
  subscriptionId: string,
): Promise<PolicyRow[]> {
  return tx
    .select()
    .from(policies)
    .where(
      inArray(
        policies.quoteId,
        tx
          .select({ quoteId: payments.quoteId })
          .from(payments)
          .where(eq(payments.stripeSubscriptionId, subscriptionId)),
      ),
    )
    .orderBy(asc(policies.createdAt), asc(policies.id));
}

/**
 * The subscription's policies `FOR UPDATE`, in the same order as policiesForSubscription. Callers
 * lock the subscription's payment rows first (lockPaymentsForSubscription), so the webhook and the
 * daily lapse job take the two in one order.
 */
export async function lockPoliciesForSubscription(
  tx: Tx,
  subscriptionId: string,
): Promise<PolicyRow[]> {
  return tx
    .select()
    .from(policies)
    .where(
      inArray(
        policies.quoteId,
        tx
          .select({ quoteId: payments.quoteId })
          .from(payments)
          .where(eq(payments.stripeSubscriptionId, subscriptionId)),
      ),
    )
    .orderBy(asc(policies.createdAt), asc(policies.id))
    .for("update");
}

/** Lapsed policies whose cover stopped at or before `cutoff` (the daily 30-day cancellation) */
export async function lapsedPoliciesSince(
  db: Db | Tx,
  cutoff: Date,
): Promise<{ id: string; quoteId: string }[]> {
  return db
    .select({ id: policies.id, quoteId: policies.quoteId })
    .from(policies)
    .where(and(eq(policies.status, "lapsed"), lte(policies.lapsedAt, cutoff)))
    .orderBy(asc(policies.lapsedAt), asc(policies.id));
}

/** The Stripe subscription paying for a quote's policies, or null for one paid in full */
export async function subscriptionForQuote(db: Db | Tx, quoteId: string): Promise<string | null> {
  const [row] = await db
    .selectDistinct({ id: payments.stripeSubscriptionId })
    .from(payments)
    .where(and(eq(payments.quoteId, quoteId), isNotNull(payments.stripeSubscriptionId)));
  return row?.id ?? null;
}

/** Every subscription Kerb holds for a Stripe customer, from its instalment rows */
export async function subscriptionsForStripeCustomer(
  db: Db | Tx,
  stripeCustomerId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: payments.stripeSubscriptionId })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(
      and(
        eq(customers.stripeCustomerId, stripeCustomerId),
        isNotNull(payments.stripeSubscriptionId),
      ),
    );
  return rows.map((row) => row.id!).sort();
}

/**
 * What /account/billing needs about a customer: their Stripe customer, and whether they pay
 * monthly (a payments row with a subscription). A customer who paid in full has a Stripe customer
 * too, but no card on file to update (ruling R12).
 */
export async function billingCustomer(
  db: Db | Tx,
  customerId: string,
): Promise<{ stripeCustomerId: string | null; monthly: boolean }> {
  const [customer] = await db
    .select({ stripeCustomerId: customers.stripeCustomerId })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!customer) return { stripeCustomerId: null, monthly: false };
  const [monthly] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.customerId, customerId), isNotNull(payments.stripeSubscriptionId)))
    .limit(1);
  return { stripeCustomerId: customer.stripeCustomerId, monthly: Boolean(monthly) };
}

export interface InstalmentPatch {
  status?: PaymentRow["status"];
  /** Set with `succeeded` or `refunded`, null otherwise (the payments_paid_at_check) */
  paidAt?: Date | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeSubscriptionId?: string | null;
  dueOn?: string;
  /** When Kerb voided the month's invoice for want of cover */
  voidedAt?: Date | null;
}

/** Updates the fields given on one payment row; a field left out is left alone */
export async function markInstalment(
  tx: Db | Tx,
  paymentId: string,
  patch: InstalmentPatch,
): Promise<void> {
  const set = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  if (Object.keys(set).length === 0) return;
  await tx.update(payments).set(set).where(eq(payments.id, paymentId));
}

/**
 * Moves a policy to `active`, `lapsed` or `cancelled`, keeping the two stamps in step with the
 * checks: `lapsed_at` only while lapsed (default now), `cancelled_at` only once cancelled (default
 * now), both cleared otherwise.
 */
export async function setPolicyStatus(
  tx: Db | Tx,
  policyId: string,
  status: PolicyRow["status"],
  stamps: { lapsedAt?: Date; cancelledAt?: Date } = {},
): Promise<void> {
  const now = new Date();
  await tx
    .update(policies)
    .set({
      status,
      lapsedAt: status === "lapsed" ? (stamps.lapsedAt ?? now) : null,
      cancelledAt: status === "cancelled" ? (stamps.cancelledAt ?? now) : null,
      updatedAt: now,
    })
    .where(eq(policies.id, policyId));
}
