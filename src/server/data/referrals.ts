import { and, asc, desc, eq, exists, ne, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "#/server/audit/audit";
import { assertNoConflict } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { quoteItems, quotes, underwritingDecisions } from "#/server/db/schema";

import { defineRead } from "./define";

// The referrals queue (4.5): quote items the rater sent to a person. The queue lists items still
// `referred`; an item that was ever referred stays readable, with its decisions, after it is decided.

export interface ReferralSummary {
  quoteItemId: string;
  quoteId: string;
  quoteReference: string;
  product: string;
  reasonCode: string | null;
  createdAt: Date;
}

export type ReferralDetail = ReferralSummary & {
  outcome: string;
  startDate: string;
  quote: { postcodeDistrict: string | null; totalPence: number | null; validUntil: Date };
  decisions: {
    id: number;
    outcome: string;
    reasonCode: string | null;
    loadingPercent: number | null;
    decidedBy: string | null;
    note: string | null;
    createdAt: Date;
  }[];
};

const summaryFields = {
  quoteItemId: quoteItems.id,
  quoteId: quoteItems.quoteId,
  quoteReference: quotes.reference,
  product: quoteItems.product,
  reasonCode: quoteItems.reasonCode,
  createdAt: quoteItems.createdAt,
};

const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
};

export const staffListReferrals = defineRead(
  "referrals.read",
  z.object(page),
  async (actor, { limit, offset }, db): Promise<ReferralSummary[]> => {
    return db
      .select(summaryFields)
      .from(quoteItems)
      .innerJoin(quotes, eq(quotes.id, quoteItems.quoteId))
      .where(
        and(
          eq(quoteItems.outcome, "referred"),
          // Own referrals are left out; with no customer row there is nothing to exclude
          actor.customerId === null ? undefined : ne(quotes.customerId, actor.customerId),
        ),
      )
      .orderBy(desc(quoteItems.createdAt), desc(quoteItems.id))
      .limit(limit)
      .offset(offset);
  },
);

export const staffGetReferral = defineRead(
  "referrals.read",
  z.object({ quoteItemId: z.uuid() }),
  async (actor, { quoteItemId }, db): Promise<ReferralDetail> => {
    // One transaction, so the view is recorded only if the read succeeds and a refused read writes
    // nothing (4.5b)
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          ...summaryFields,
          customerId: quotes.customerId,
          outcome: quoteItems.outcome,
          startDate: quoteItems.startDate,
          postcodeDistrict: quotes.postcodeDistrict,
          totalPence: quotes.totalPence,
          validUntil: quotes.validUntil,
        })
        .from(quoteItems)
        .innerJoin(quotes, eq(quotes.id, quoteItems.quoteId))
        .where(
          and(
            eq(quoteItems.id, quoteItemId),
            // A referral is an item that is referred now or ever was
            or(
              eq(quoteItems.outcome, "referred"),
              exists(
                tx
                  .select({ one: underwritingDecisions.id })
                  .from(underwritingDecisions)
                  .where(
                    and(
                      eq(underwritingDecisions.quoteItemId, quoteItems.id),
                      eq(underwritingDecisions.outcome, "referred"),
                    ),
                  ),
              ),
            ),
          ),
        );
      if (!row) throw new AuthzError("NOT_FOUND");
      assertNoConflict(actor, row.customerId);
      await audit(tx, {
        actor,
        action: "referral.viewed",
        entityType: "quote_item",
        entityId: quoteItemId,
      });

      const decisions = await tx
        .select({
          id: underwritingDecisions.id,
          outcome: underwritingDecisions.outcome,
          reasonCode: underwritingDecisions.reasonCode,
          loadingPercent: underwritingDecisions.loadingPercent,
          decidedBy: underwritingDecisions.decidedBy,
          note: underwritingDecisions.note,
          createdAt: underwritingDecisions.createdAt,
        })
        .from(underwritingDecisions)
        .where(eq(underwritingDecisions.quoteItemId, quoteItemId))
        .orderBy(asc(underwritingDecisions.createdAt), asc(underwritingDecisions.id));

      return {
        quoteItemId: row.quoteItemId,
        quoteId: row.quoteId,
        quoteReference: row.quoteReference,
        product: row.product,
        reasonCode: row.reasonCode,
        createdAt: row.createdAt,
        outcome: row.outcome,
        startDate: row.startDate,
        quote: {
          postcodeDistrict: row.postcodeDistrict,
          totalPence: row.totalPence,
          validUntil: row.validUntil,
        },
        decisions,
      };
    });
  },
);
