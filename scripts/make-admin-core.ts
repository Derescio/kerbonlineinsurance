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

// Raw SQL on purpose: package scripts run under plain `node`, and src/ imports have no file
// extensions, so a script can't import the app's data layer (same reason as db-deploy.ts). It can
// import chain.ts, which has no imports of its own (spec call 15), so the staff.added row is built
// and hashed by the same functions as the app's audit rows and verifies with the same code.

export type MakeAdminReason = "no_user" | "unverified" | "already_staff" | "bad_name";

export class MakeAdminError extends Error {
  readonly reason: MakeAdminReason;
  constructor(reason: MakeAdminReason) {
    super(reason);
    this.name = "MakeAdminError";
    this.reason = reason;
  }
}

export async function makeAdmin(
  client: pg.ClientBase,
  email: string,
  displayName: string,
  keys: AuditKeys,
): Promise<{ userId: string; staffCode: string }> {
  const name = displayName.trim();
  if (name === "") throw new MakeAdminError("bad_name");
  // Better Auth stores emails lowercase
  const normalised = email.trim().toLowerCase();
  // Checked before begin, so a missing key writes nothing
  const keyVersion = keys.activeVersion;
  const key = keys.keys.get(keyVersion);
  if (!key) throw new Error(`Audit key version ${keyVersion} is not loaded`);

  await client.query("begin");
  try {
    const found = await client.query<{ id: string; email_verified: boolean }>(
      "select id, email_verified from users where email = $1",
      [normalised],
    );
    const user = found.rows[0];
    if (!user) throw new MakeAdminError("no_user");
    if (!user.email_verified) throw new MakeAdminError("unverified");

    const existing = await client.query("select 1 from staff_members where user_id = $1", [
      user.id,
    ]);
    if (existing.rowCount) throw new MakeAdminError("already_staff");

    // The unique constraint on staff_code catches two scripts racing for the same number
    const next = await client.query<{ n: number }>(
      "select coalesce(max(substring(staff_code from 3)::int), 0) + 1 as n from staff_members",
    );
    const staffCode = `H-${String(next.rows[0]!.n).padStart(3, "0")}`;

    await client.query(
      "insert into staff_members (user_id, display_name, staff_code) values ($1, $2, $3)",
      [user.id, name, staffCode],
    );
    await client.query("insert into staff_roles (user_id, role) values ($1, 'admin')", [user.id]);

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
      action: "staff.added",
      entityType: AUDIT_ACTIONS["staff.added"].entityType,
      entityId: user.id,
      changes: { roles: ["admin"] },
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
        JSON.stringify(row.changes),
        row.reason,
        row.requestId,
        row.ipHash,
        row.prevHash,
        row.keyVersion,
        computeHash(row, key),
      ],
    );
    await client.query("commit");
    return { userId: user.id, staffCode };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
