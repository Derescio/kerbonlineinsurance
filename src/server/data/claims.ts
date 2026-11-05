import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { assertNoConflict } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { claims } from "#/server/db/schema";
import { claimStatuses } from "#/server/db/schema/values";

import { defineRead } from "./define";
import { claimDetailColumns, claimSummaryColumns } from "./summaries";

// Claim reads (4.5). The customer reads return only the signed-in customer's own claims and never
// staff notes (`internal` events); the staff reads further down show everything except the staff
// member's own claims.

export interface ClaimSummary {
  id: string;
  reference: string;
  policyId: string;
  status: string;
  incidentType: string;
  incidentAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface ClaimEventView {
  id: number;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: Date;
}

export type CustomerClaimDetail = ClaimSummary & {
  incidentLocation: string | null;
  description: string | null;
  otherVehicleInvolved: boolean;
  rearEnded: boolean;
  injuries: boolean;
  policeAttended: boolean;
  policeReference: string | null;
  claimedAmountPence: number | null;
  version: number;
  events: ClaimEventView[];
};

export const listMyClaims = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<ClaimSummary[]> => {
    if (!actor.customerId) return [];
    return db.query.claims.findMany({
      columns: claimSummaryColumns,
      where: eq(claims.customerId, actor.customerId),
      orderBy: desc(claims.createdAt),
    });
  },
);

export const getMyClaim = defineRead(
  "signed_in",
  z.object({ claimId: z.uuid() }),
  async (actor, { claimId }, db): Promise<CustomerClaimDetail> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const claim = await db.query.claims.findFirst({
      columns: claimDetailColumns,
      where: and(eq(claims.id, claimId), eq(claims.customerId, actor.customerId)),
      with: {
        events: {
          columns: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            createdAt: true,
          },
          where: (event, { eq }) => eq(event.visibility, "customer"),
          orderBy: (event, { asc }) => [asc(event.createdAt)],
        },
      },
    });
    if (!claim) throw new AuthzError("NOT_FOUND");
    return claim;
  },
);

export type StaffClaimSummary = ClaimSummary & {
  customerId: string;
  assignedHandlerId: string | null;
};

export type StaffClaimDetail = Omit<CustomerClaimDetail, "events"> & {
  customerId: string;
  assignedHandlerId: string | null;
  events: (ClaimEventView & { visibility: string; actorUserId: string | null })[];
};

const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
};

export const staffListClaims = defineRead(
  "claims.read_all",
  z.object({ status: z.enum(claimStatuses).optional(), ...page }),
  async (actor, { status, limit, offset }, db): Promise<StaffClaimSummary[]> => {
    return db.query.claims.findMany({
      columns: { ...claimSummaryColumns, customerId: true, assignedHandlerId: true },
      where: and(
        status ? eq(claims.status, status) : undefined,
        // A staff member who is also a customer never sees their own claims in the queue. With no
        // customer row there is nothing to exclude (never `ne(col, null)`, which matches nothing).
        actor.customerId === null ? undefined : ne(claims.customerId, actor.customerId),
      ),
      orderBy: [desc(claims.createdAt), desc(claims.id)],
      limit,
      offset,
    });
  },
);

export const staffGetClaim = defineRead(
  "claims.read_all",
  z.object({ claimId: z.uuid() }),
  async (actor, { claimId }, db): Promise<StaffClaimDetail> => {
    const claim = await db.query.claims.findFirst({
      columns: { ...claimDetailColumns, customerId: true, assignedHandlerId: true },
      where: eq(claims.id, claimId),
      with: {
        events: {
          columns: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            createdAt: true,
            visibility: true,
            actorUserId: true,
          },
          orderBy: (event, { asc }) => [asc(event.createdAt), asc(event.id)],
        },
      },
    });
    if (!claim) throw new AuthzError("NOT_FOUND");
    assertNoConflict(actor, claim.customerId);
    return claim;
  },
);
