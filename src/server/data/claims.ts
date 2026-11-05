import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { AuthzError } from "#/server/auth/errors";
import { claims } from "#/server/db/schema";

import { defineRead } from "./define";
import { claimSummaryColumns } from "./summaries";

// The signed-in customer's own claims (4.5). Staff notes (`internal` events) never leave the server.

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
      columns: {
        ...claimSummaryColumns,
        incidentLocation: true,
        description: true,
        otherVehicleInvolved: true,
        rearEnded: true,
        injuries: true,
        policeAttended: true,
        policeReference: true,
        claimedAmountPence: true,
        version: true,
      },
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
