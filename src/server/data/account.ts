import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { OPEN_CLAIM_STATUSES } from "#/server/account/constants";
import type { Db } from "#/server/db/client";
import {
  accountClosures,
  bundles,
  claims,
  customers,
  payments,
  policies,
} from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

// Where an account stands and what records it holds (4.7). Plain functions, not defineRead: they
// serve the actor lookup, closure and delete, which already know who is asking. actor.ts imports
// this file directly (never the data index), which would otherwise be a cycle through define.ts.

export type AccountState =
  | { kind: "active" }
  | { kind: "closure_requested"; closureId: string; closesAt: Date; heldSince: Date | null }
  | { kind: "closed"; closedAt: Date };

export interface RecordsOnFile {
  policies: { id: string; product: string; status: string }[];
  claims: { reference: string; open: boolean }[];
  hasPayments: boolean;
  hasBundles: boolean;
}

const openStatuses: readonly string[] = OPEN_CLAIM_STATUSES;

/** One indexed lookup: a closed row wins, then an open one; cancelled rows don't count */
export async function getAccountState(db: Db | Tx, userId: string): Promise<AccountState> {
  const [row] = await db
    .select({
      id: accountClosures.id,
      closesAt: accountClosures.closesAt,
      heldSince: accountClosures.heldSince,
      closedAt: accountClosures.closedAt,
    })
    .from(accountClosures)
    .where(and(eq(accountClosures.userId, userId), isNull(accountClosures.cancelledAt)))
    .orderBy(desc(isNotNull(accountClosures.closedAt)), desc(accountClosures.requestedAt))
    .limit(1);
  if (!row) return { kind: "active" };
  if (row.closedAt) return { kind: "closed", closedAt: row.closedAt };
  return {
    kind: "closure_requested",
    closureId: row.id,
    closesAt: row.closesAt,
    heldSince: row.heldSince,
  };
}

async function customerIdOf(db: Db | Tx, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.userId, userId));
  return row?.id ?? null;
}

export async function recordsOnFile(db: Db | Tx, userId: string): Promise<RecordsOnFile> {
  const customerId = await customerIdOf(db, userId);
  if (!customerId) return { policies: [], claims: [], hasPayments: false, hasBundles: false };

  const [policyRows, claimRows, paymentRows, bundleRows] = await Promise.all([
    db
      .select({ id: policies.id, product: policies.product, status: policies.status })
      .from(policies)
      .where(eq(policies.customerId, customerId))
      .orderBy(asc(policies.createdAt)),
    db
      .select({ reference: claims.reference, status: claims.status })
      .from(claims)
      .where(and(eq(claims.customerId, customerId), ne(claims.status, "draft")))
      .orderBy(asc(claims.createdAt)),
    db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.customerId, customerId))
      .limit(1),
    db.select({ id: bundles.id }).from(bundles).where(eq(bundles.customerId, customerId)).limit(1),
  ]);

  return {
    policies: policyRows,
    claims: claimRows.map((c) => ({
      reference: c.reference,
      open: openStatuses.includes(c.status),
    })),
    hasPayments: paymentRows.length > 0,
    hasBundles: bundleRows.length > 0,
  };
}

/** Insurance records are any policy, payment or bundle; quotes and drafts alone aren't */
export function hasRecordsOnFile(r: RecordsOnFile): boolean {
  return r.policies.length > 0 || r.hasPayments || r.hasBundles;
}

/** The oldest open claim's reference, or null */
export async function openClaimReference(db: Db | Tx, userId: string): Promise<string | null> {
  const customerId = await customerIdOf(db, userId);
  if (!customerId) return null;
  const [row] = await db
    .select({ reference: claims.reference })
    .from(claims)
    .where(and(eq(claims.customerId, customerId), inArray(claims.status, [...OPEN_CLAIM_STATUSES])))
    .orderBy(asc(claims.createdAt))
    .limit(1);
  return row?.reference ?? null;
}
