import { desc, sql } from "drizzle-orm";

import {
  AUDIT_LOCK_KEY,
  assertChainable,
  computeHash,
  nextCreatedAt,
  type AuditKeys,
  type AuditValue,
  type ChainRow,
} from "./chain";

import type { Actor } from "#/server/auth/actor";
import type { Tx } from "#/server/db/tx";
import { auditLog } from "#/server/db/schema";
import { getAuditEnv } from "#/server/env";

// Writes the HMAC-chained audit_log (4.5b). audit() runs inside the caller's transaction, so the
// row and the change it records commit or roll back together. A transaction-scoped advisory lock
// serialises writers: each row is read-then-linked against the latest one, and the lock is held
// until the caller commits, so two writers can never both extend the same row. The read after the
// lock relies on the caller's transaction being READ COMMITTED: under REPEATABLE READ or
// SERIALIZABLE a read before audit() fixes the snapshot, and the prev_hash unique constraint then
// fails the transaction rather than forking the chain.

export interface AuditEntry {
  /** Null means the system */
  actor: Actor | null;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, AuditValue>;
  reason?: string;
  requestId?: string;
  ipHash?: string;
}

// "customer" for a signed-in actor without staff, the sorted staff roles joined with a comma for
// staff, null for the system
export function actorRoleOf(actor: Actor | null): string | null {
  if (!actor) return null;
  if (!actor.staff) return "customer";
  return [...actor.staff.roles].sort().join(",");
}

// The default keys are read on every call, so missing keys throw inside the caller's transaction
// and nothing is written
export async function audit(
  tx: Tx,
  entry: AuditEntry,
  keys: AuditKeys = getAuditEnv(),
): Promise<typeof auditLog.$inferSelect> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)`);

  const [latest] = await tx
    .select({ hash: auditLog.hash, createdAt: auditLog.createdAt })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);

  const keyVersion = keys.activeVersion;
  const key = keys.keys.get(keyVersion);
  if (!key) throw new Error(`Audit key version ${keyVersion} is not loaded`);

  const row: ChainRow = {
    prevHash: latest?.hash ?? null,
    keyVersion,
    createdAt: nextCreatedAt(latest?.createdAt ?? null, new Date()),
    actorUserId: entry.actor?.userId ?? null,
    actorRole: actorRoleOf(entry.actor),
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes ?? null,
    reason: entry.reason ?? null,
    requestId: entry.requestId ?? null,
    ipHash: entry.ipHash ?? null,
  };
  assertChainable(row);

  const [inserted] = await tx
    .insert(auditLog)
    .values({ ...row, hash: computeHash(row, key) })
    .returning();
  return inserted!;
}
