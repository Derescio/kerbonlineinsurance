import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  sql,
} from "drizzle-orm";

import { CLOSURE_WINDOW_DAYS, OPEN_CLAIM_STATUSES, RETENTION } from "#/server/account/constants";
import { getDb, type Db } from "#/server/db/client";
import {
  accountClosures,
  accounts,
  bundles,
  claims,
  customers,
  idempotencyKeys,
  notifications,
  payments,
  policies,
  quotes,
  rateLimits,
  reviews,
  sessions,
  staffMembers,
  twoFactors,
  users,
  verifications,
} from "#/server/db/schema";
import { withTx, type Tx } from "#/server/db/tx";

import { markClosureFiles } from "./file-rows";

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

// The daily closure job (4.7 call 14). runClosures in src/server/account/ decides; these read and
// write.

export type { Db };

/** The app's database, for the job's entry point (the cron route can't reach db/client) */
export function accountDb(): Db {
  return getDb();
}

export interface DueClosure {
  id: string;
  userId: string;
}

/** Open closures whose window has ended by `now`, oldest first. Read without locks */
export async function dueClosures(db: Db, now: Date): Promise<DueClosure[]> {
  return db
    .select({ id: accountClosures.id, userId: accountClosures.userId })
    .from(accountClosures)
    .where(
      and(
        lte(accountClosures.closesAt, now),
        isNull(accountClosures.cancelledAt),
        isNull(accountClosures.closedAt),
      ),
    )
    .orderBy(asc(accountClosures.closesAt));
}

/**
 * The closure, locked FOR UPDATE SKIP LOCKED, if it's still open; null if it was cancelled or
 * closed meanwhile, or another transaction holds it (a cancel in flight, or another run).
 */
export async function lockDueClosure(
  tx: Tx,
  closureId: string,
): Promise<{ id: string; userId: string; heldSince: Date | null } | null> {
  const [row] = await tx
    .select({
      id: accountClosures.id,
      userId: accountClosures.userId,
      heldSince: accountClosures.heldSince,
    })
    .from(accountClosures)
    .where(
      and(
        eq(accountClosures.id, closureId),
        isNull(accountClosures.cancelledAt),
        isNull(accountClosures.closedAt),
      ),
    )
    .for("update", { skipLocked: true });
  return row ?? null;
}

/** Starts the hold; held_since is the transaction's now() */
export async function holdClosureRow(tx: Tx, closureId: string, reason: string): Promise<void> {
  await tx
    .update(accountClosures)
    .set({ heldSince: sql`now()`, holdReason: reason })
    .where(eq(accountClosures.id, closureId));
}

/**
 * Ends the closure. closed_at is the transaction's now() and retain_until is added to it in SQL,
 * so retain_until = closed_at + the retention years exactly.
 */
export async function closeClosureRow(tx: Tx, closureId: string): Promise<{ retainUntil: Date }> {
  const [row] = await tx
    .update(accountClosures)
    .set({
      closedAt: sql`now()`,
      retainUntil: sql`now() + make_interval(years => ${RETENTION.insuranceRecordsYears})`,
    })
    .where(eq(accountClosures.id, closureId))
    .returning({ retainUntil: accountClosures.retainUntil });
  return { retainUntil: row!.retainUntil! };
}

/**
 * What a closed account keeps and loses (4.7 call 9). The users row, the customer row, policies,
 * submitted claims, payments, bundles, the quotes behind them, security_events and audit_log are
 * never touched here. Everything below is either a way back in (credentials, sessions, reset
 * links, keys) or has no retention reason.
 */
export async function closeAccountRows(tx: Tx, userId: string): Promise<void> {
  // Ways back in
  await tx.delete(accounts).where(eq(accounts.userId, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
  // Unused password-reset links (reset-password:<token>), whose value is the user id. Better
  // Auth's reset would otherwise put a password back on the closed user.
  await tx.delete(verifications).where(eq(verifications.value, userId));
  await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
  // The app's limiter keys end in `:user:<id>` (rateLimitSubject); an exact suffix match, so an
  // id is never read as a LIKE pattern
  const suffix = `:user:${userId}`;
  await tx.delete(rateLimits).where(sql`right(${rateLimits.key}, ${suffix.length}) = ${suffix}`);
  await tx.delete(notifications).where(eq(notifications.userId, userId));

  const customerId = await customerIdOf(tx, userId);
  if (customerId) {
    // Their files first (4.10): draft-claim and review files go, submitted claims' evidence stays
    await markClosureFiles(tx, customerId);
    await tx.delete(reviews).where(eq(reviews.customerId, customerId));
    // Never submitted, so not a record
    await tx
      .delete(claims)
      .where(and(eq(claims.customerId, customerId), eq(claims.status, "draft")));
    // Quotes that never became a policy and have no payment or bundle (their items, options,
    // details and decisions cascade). A quote any of those point at is kept, so RESTRICT is
    // never hit.
    await tx
      .delete(quotes)
      .where(
        and(
          eq(quotes.customerId, customerId),
          notExists(
            tx.select({ id: policies.id }).from(policies).where(eq(policies.quoteId, quotes.id)),
          ),
          notExists(
            tx.select({ id: payments.id }).from(payments).where(eq(payments.quoteId, quotes.id)),
          ),
          notExists(
            tx.select({ id: bundles.id }).from(bundles).where(eq(bundles.quoteId, quotes.id)),
          ),
        ),
      );
  }

  // The row stays (customers, audit_log and security_events point at it); the address is freed
  await tx
    .update(users)
    .set({
      email: `closed+${userId}@closed.invalid`,
      name: "Closed account",
      image: null,
      emailVerified: false,
    })
    .where(eq(users.id, userId));
}
