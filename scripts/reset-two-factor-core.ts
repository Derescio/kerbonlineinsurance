import type pg from "pg";

import { AUDIT_ACTIONS } from "../src/server/audit/actions.ts";
import {
  AUDIT_LOCK_KEY,
  assertChainable,
  computeHash,
  nextCreatedAt,
  type AuditKeys,
  type ChainRow,
} from "../src/server/audit/chain.ts";

// auth:reset-two-factor (4.6, call 12): for a staff member who has lost both their phone and their
// backup codes. Raw SQL for the same reason as make-admin-core.ts (plain node, no `#/` aliases),
// and the two_factor.reset row is chained exactly as staff.added is there.

export type ResetTwoFactorReason = "unknown_email";

export class ResetTwoFactorError extends Error {
  readonly reason: ResetTwoFactorReason;
  constructor(reason: ResetTwoFactorReason) {
    super(reason);
    this.name = "ResetTwoFactorError";
    this.reason = reason;
  }
}

/**
 * In one transaction: 2FA off, the TOTP secret and backup codes gone, trusted devices gone, every
 * session ended, and one two_factor.reset row with a null actor (the script). The next staff page
 * sends them to setup.
 */
export async function resetTwoFactor(
  client: pg.ClientBase,
  email: string,
  keys: AuditKeys,
): Promise<{ userId: string }> {
  // Better Auth stores emails lowercase
  const normalised = email.trim().toLowerCase();
  // Checked before begin, so a missing key writes nothing
  const keyVersion = keys.activeVersion;
  const key = keys.keys.get(keyVersion);
  if (!key) throw new Error(`Audit key version ${keyVersion} is not loaded`);

  await client.query("begin");
  try {
    const found = await client.query<{ id: string }>("select id from users where email = $1", [
      normalised,
    ]);
    const user = found.rows[0];
    if (!user) throw new ResetTwoFactorError("unknown_email");

    await client.query("update users set two_factor_enabled = false where id = $1", [user.id]);
    await client.query("delete from two_factors where user_id = $1", [user.id]);
    // Better Auth keeps each trusted device as a verification row whose value is the user id
    await client.query(
      "delete from verifications where identifier like 'trust-device-%' and value = $1",
      [user.id],
    );
    await client.query("delete from sessions where user_id = $1", [user.id]);

    // The same lock as audit(), so this row extends the chain even while the app is writing to it
    await client.query("select pg_advisory_xact_lock($1::bigint)", [AUDIT_LOCK_KEY]);
    const latest = await client.query<{ hash: string; created_at: Date }>(
      "select hash, created_at from audit_log order by id desc limit 1",
    );
    const previous = latest.rows[0];
    const row: ChainRow = {
      prevHash: previous?.hash ?? null,
      keyVersion,
      createdAt: nextCreatedAt(previous?.created_at ?? null, new Date()),
      actorUserId: null,
      actorRole: null,
      action: "two_factor.reset",
      entityType: AUDIT_ACTIONS["two_factor.reset"].entityType,
      entityId: user.id,
      changes: null,
      reason: null,
      requestId: null,
      ipHash: null,
    };
    assertChainable(row);
    await client.query(
      `insert into audit_log
         (created_at, actor_user_id, actor_role, action, entity_type, entity_id, changes, reason,
          request_id, ip_hash, prev_hash, key_version, hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.createdAt,
        row.actorUserId,
        row.actorRole,
        row.action,
        row.entityType,
        row.entityId,
        row.changes === null ? null : JSON.stringify(row.changes),
        row.reason,
        row.requestId,
        row.ipHash,
        row.prevHash,
        row.keyVersion,
        computeHash(row, key),
      ],
    );
    await client.query("commit");
    return { userId: user.id };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
