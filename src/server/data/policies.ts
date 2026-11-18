import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { AuthzError } from "#/server/auth/errors";
import { payments, policies, quotes } from "#/server/db/schema";

import type { ClaimSummary } from "./claims";
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

/**
 * A listed policy, whether it's paid monthly by a Stripe subscription (5.6b, decision 9), and the
 * car + home bundle it was bought in, with the saving that quote gave (5.7b)
 */
export type PolicyListItem = PolicySummary & {
  monthly: boolean;
  bundle: { id: string; savingPence: number } | null;
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
      columns: { ...summaryColumns, quoteId: true, bundleId: true },
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
    return rows.map(({ quoteId, bundleId, ...policy }) => ({
      ...policy,
      monthly: monthlyQuotes.has(quoteId),
      bundle: bundleId ? { id: bundleId, savingPence: savings.get(quoteId) ?? 0 } : null,
    }));
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
