import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "#/server/db/client";
import { checkoutSessions, customers, payments, policies, stripeEvents } from "#/server/db/schema";
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

export interface InstalmentPatch {
  status?: PaymentRow["status"];
  /** Set with `succeeded` or `refunded`, null otherwise (the payments_paid_at_check) */
  paidAt?: Date | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeSubscriptionId?: string | null;
  dueOn?: string;
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
