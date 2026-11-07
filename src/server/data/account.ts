import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { CLOSURE_WINDOW_DAYS, OPEN_CLAIM_STATUSES } from "#/server/account/constants";
import { getDb, type Db } from "#/server/db/client";
import {
  accountClosures,
  bundles,
  claims,
  customers,
  payments,
  policies,
  sessions,
  staffMembers,
  users,
} from "#/server/db/schema";
import { withTx, type Tx } from "#/server/db/tx";

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

// The writes behind delete, request and cancel (4.7). Each takes the caller's transaction; the
// orchestration in src/server/account/ decides the order and writes the audit rows.

/** Runs `run` in one transaction on the app's database (src/server/account/ can't reach it) */
export function withAccountTx<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return withTx(getDb(), run);
}

/**
 * Locks the user's row and returns their email, or null if the user is gone. `delete` takes FOR
 * UPDATE, which the delete needs; `write` takes FOR NO KEY UPDATE, which still serialises two
 * requests but doesn't block a sign-in inserting a session (its foreign key check takes KEY SHARE).
 */
export async function lockUser(
  tx: Tx,
  userId: string,
  mode: "delete" | "write",
): Promise<{ email: string } | null> {
  const query = tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const [row] = await (mode === "delete" ? query.for("update") : query.for("no key update"));
  return row ?? null;
}

/** Any staff_members row, active or deactivated */
export async function hasStaffRow(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ userId: staffMembers.userId })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId));
  return rows.length > 0;
}

/** Any closure row at all, open, cancelled or closed */
export async function hasAnyClosure(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: accountClosures.id })
    .from(accountClosures)
    .where(eq(accountClosures.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/** Deletes the user; the foreign keys cascade to the rest and record_delete tombstones them */
export async function deleteUserRow(tx: Tx, userId: string): Promise<void> {
  await tx.delete(users).where(eq(users.id, userId));
}

/** The user's open closure, locked FOR UPDATE (the daily job locks the same row), or null */
export async function lockOpenClosure(
  tx: Tx,
  userId: string,
): Promise<{ id: string; closesAt: Date } | null> {
  const [row] = await tx
    .select({ id: accountClosures.id, closesAt: accountClosures.closesAt })
    .from(accountClosures)
    .where(
      and(
        eq(accountClosures.userId, userId),
        isNull(accountClosures.cancelledAt),
        isNull(accountClosures.closedAt),
      ),
    )
    .for("update");
  return row ?? null;
}

/**
 * Opens a closure. Both times come from the one transaction's now(), and the window is added in
 * SQL, so closes_at is exactly what account_closures_window_check computes.
 */
export async function insertClosure(
  tx: Tx,
  userId: string,
): Promise<{ id: string; closesAt: Date }> {
  const [row] = await tx
    .insert(accountClosures)
    .values({
      userId,
      requestedAt: sql`now()`,
      closesAt: sql`now() + make_interval(days => ${CLOSURE_WINDOW_DAYS})`,
    })
    .returning({ id: accountClosures.id, closesAt: accountClosures.closesAt });
  return row!;
}

export async function cancelClosureRow(tx: Tx, closureId: string): Promise<void> {
  await tx
    .update(accountClosures)
    .set({ cancelledAt: sql`now()` })
    .where(eq(accountClosures.id, closureId));
}

/** Ends every session of the user's except `keepSessionId`; returns how many went */
export async function deleteOtherSessions(
  tx: Tx,
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const deleted = await tx
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });
  return deleted.length;
}

export async function userEmail(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return row?.email ?? null;
}
