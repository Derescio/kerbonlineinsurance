import { and, asc, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";

import { AuthzError } from "#/server/auth/errors";
import { londonDate } from "#/lib/london-date";
import { payments, policies, properties, quotes, vehicles } from "#/server/db/schema";

import type { ClaimSummary } from "./claims";
import type { Db } from "#/server/db/client";

import { defineRead } from "./define";
import { claimSummaryColumns } from "./summaries";

// The signed-in customer's own policies (4.5). Every query filters by actor.customerId, so someone
// else's policy is indistinguishable from a missing one.

export interface PolicySummary {
  id: string;
  reference: string;
  product: string;
  coverLevel: string;
  status: string;
  startsOn: string;
  endsOn: string;
}

/** What a policy insures, for the Overview's rows (6.1, decision 5); null with no detail row */
export type PolicyLabel =
  | { kind: "car"; plate: string | null; make: string; model: string }
  | { kind: "home"; line1: string; town: string }
  | null;

/**
 * A listed policy, whether it's paid monthly by a Stripe subscription (5.6b, decision 9), the
 * car + home bundle it was bought in, with the saving that quote gave (5.7b), what it insures and
 * its yearly premium (6.1)
 */
export type PolicyListItem = PolicySummary & {
  monthly: boolean;
  bundle: { id: string; savingPence: number } | null;
  label: PolicyLabel;
  annualPremiumPence: number;
};

export type PolicyDetail = PolicySummary & {
  annualPremiumPence: number;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  autoRenew: boolean;
  claims: ClaimSummary[];
};

const summaryColumns = {
  id: true,
  reference: true,
  product: true,
  coverLevel: true,
  status: true,
  startsOn: true,
  endsOn: true,
} as const;

export const listMyPolicies = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<PolicyListItem[]> => {
    if (!actor.customerId) return [];
    const rows = await db.query.policies.findMany({
      columns: {
        ...summaryColumns,
        quoteId: true,
        quoteItemId: true,
        bundleId: true,
        annualPremiumPence: true,
      },
      where: eq(policies.customerId, actor.customerId),
      orderBy: desc(policies.createdAt),
    });
    // Monthly means a Stripe subscription, which the portal can change the card on: 5.6's demo
    // monthly rows have none (ruling R12, as /account/billing decides)
    const subscribed = await db
      .selectDistinct({ quoteId: payments.quoteId })
      .from(payments)
      .where(
        and(eq(payments.customerId, actor.customerId), isNotNull(payments.stripeSubscriptionId)),
      );
    const monthlyQuotes = new Set(subscribed.map((row) => row.quoteId));
    // A bundle's saving is its quote's discount on the combined premiums
    const bundledQuotes = [...new Set(rows.filter((r) => r.bundleId).map((r) => r.quoteId))];
    const savings = new Map(
      bundledQuotes.length
        ? (
            await db
              .select({ id: quotes.id, savingPence: quotes.bundleDiscountPence })
              .from(quotes)
              .where(
                and(eq(quotes.customerId, actor.customerId), inArray(quotes.id, bundledQuotes)),
              )
          ).map((q) => [q.id, q.savingPence ?? 0])
        : [],
    );
    const labels = await labelsFor(
      db,
      rows.map((r) => r.quoteItemId),
    );
    return rows.map(({ quoteId, quoteItemId, bundleId, ...policy }) => ({
      ...policy,
      monthly: monthlyQuotes.has(quoteId),
      bundle: bundleId ? { id: bundleId, savingPence: savings.get(quoteId) ?? 0 } : null,
      label: labels.get(quoteItemId) ?? null,
    }));
  },
);

/** Each quote item's car or home, read from its detail row. The ids come from the actor's policies */
async function labelsFor(db: Db, quoteItemIds: string[]): Promise<Map<string, PolicyLabel>> {
  const labels = new Map<string, PolicyLabel>();
  if (quoteItemIds.length === 0) return labels;
  const [cars, homes] = await Promise.all([
    db
      .select({
        quoteItemId: vehicles.quoteItemId,
        plate: vehicles.registration,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(vehicles)
      .where(inArray(vehicles.quoteItemId, quoteItemIds)),
    db
      .select({
        quoteItemId: properties.quoteItemId,
        line1: properties.addressLine1,
        town: properties.town,
      })
      .from(properties)
      .where(inArray(properties.quoteItemId, quoteItemIds)),
  ]);
  for (const { quoteItemId, ...car } of cars) labels.set(quoteItemId, { kind: "car", ...car });
  for (const { quoteItemId, ...home } of homes) labels.set(quoteItemId, { kind: "home", ...home });
  return labels;
}

/** The Overview's "Next payment" card (6.1, decision 4) */
export type NextPayment =
  | { kind: "overdue"; outstandingPence: number }
  | { kind: "due"; amountPence: number; dueOn: string }
  | { kind: "none" };

/** Unpaid: not taken yet, or taken and refused */
const UNPAID = ["scheduled", "failed"] as const;

/**
 * Overdue payments first (their total), else the earliest unpaid payment due today or later in
 * London, else none. `now` is for the tests
 */
export const getMyNextPayment = defineRead(
  "signed_in",
  z.object({ now: z.date().optional() }),
  async (actor, { now }, db): Promise<NextPayment> => {
    if (!actor.customerId) return { kind: "none" };
    const today = londonDate(now ?? new Date());
    const mine = and(
      eq(payments.customerId, actor.customerId),
      inArray(payments.status, [...UNPAID]),
    );
    const overdue = await db
      .select({ amountPence: payments.amountPence })
      .from(payments)
      .where(and(mine, lt(payments.dueOn, today)));
    if (overdue.length > 0) {
      return {
        kind: "overdue",
        outstandingPence: overdue.reduce((total, row) => total + row.amountPence, 0),
      };
    }
    const [next] = await db
      .select({ amountPence: payments.amountPence, dueOn: payments.dueOn })
      .from(payments)
      .where(and(mine, gte(payments.dueOn, today)))
      .orderBy(asc(payments.dueOn), asc(payments.id))
      .limit(1);
    return next ? { kind: "due", ...next } : { kind: "none" };
  },
);

export const getMyPolicy = defineRead(
  "signed_in",
  z.object({ policyId: z.uuid() }),
  async (actor, { policyId }, db): Promise<PolicyDetail> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const policy = await db.query.policies.findFirst({
      columns: {
        ...summaryColumns,
        annualPremiumPence: true,
        compulsoryExcessPence: true,
        voluntaryExcessPence: true,
        autoRenew: true,
      },
      where: and(eq(policies.id, policyId), eq(policies.customerId, actor.customerId)),
      with: {
        claims: {
          columns: claimSummaryColumns,
          orderBy: (claim, { desc }) => [desc(claim.createdAt)],
        },
      },
    });
    if (!policy) throw new AuthzError("NOT_FOUND");
    return policy;
  },
);
