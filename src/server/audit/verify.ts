// Walks the audit chain and names the first row that was altered or whose link is broken (4.5b).
//
// This file imports only ./chain.ts, with the extension: the verify script loads it under plain
// Node, which resolves neither the `#/` alias nor extensionless paths.
//
// Limitation (spec decision 6): the chain proves rows weren't altered, inserted or removed from
// the middle. Deleting the newest rows, or rolling the whole database back, leaves a valid chain.
// The daily anchor in R2 (anchor.ts, 4.11) closes that gap: verifyAgainstAnchors checks it.
import { computeHash, type AuditKeys, type AuditValue, type ChainRow } from "./chain.ts";

// A pg Pool or Client satisfies this; app code passes getDb().$client
export interface Queryable {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export type VerifyResult =
  | { ok: true; rows: number; lastId: number | null; lastHash: string | null }
  | {
      ok: false;
      rowId: number;
      reason: "bad_genesis" | "broken_link" | "unknown_key_version" | "hash_mismatch";
    };

interface DbRow {
  id: string;
  created_at: Date;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, AuditValue> | null;
  reason: string | null;
  request_id: string | null;
  ip_hash: string | null;
  prev_hash: string | null;
  key_version: string;
  hash: string;
}

export async function verifyAuditChain(
  db: Queryable,
  keys: Pick<AuditKeys, "keys">,
  options: { batchSize?: number } = {},
): Promise<VerifyResult> {
  const batchSize = options.batchSize ?? 500;
  let afterId = 0;
  let count = 0;
  let lastId: number | null = null;
  let lastHash: string | null = null;

  for (;;) {
    const { rows } = await db.query<DbRow>(
      `select id, created_at, actor_user_id, actor_role, action, entity_type, entity_id, changes,
              reason, request_id, ip_hash, prev_hash, key_version, hash
         from audit_log where id > $1 order by id limit $2`,
      [afterId, batchSize],
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      const rowId = Number(r.id);
      // The previous hash carries across batches, so a break at a batch edge is still caught
      if (lastId === null) {
        if (r.prev_hash !== null) return { ok: false, rowId, reason: "bad_genesis" };
      } else if (r.prev_hash !== lastHash) {
        return { ok: false, rowId, reason: "broken_link" };
      }
      const key = keys.keys.get(r.key_version);
      if (!key) return { ok: false, rowId, reason: "unknown_key_version" };

      const chainRow: ChainRow = {
        prevHash: r.prev_hash,
        keyVersion: r.key_version,
        createdAt: r.created_at,
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        changes: r.changes,
        reason: r.reason,
        requestId: r.request_id,
        ipHash: r.ip_hash,
      };
      if (computeHash(chainRow, key) !== r.hash) {
        return { ok: false, rowId, reason: "hash_mismatch" };
      }
      lastId = rowId;
      lastHash = r.hash;
      count++;
    }
    afterId = lastId!;
  }
  return { ok: true, rows: count, lastId, lastHash };
}
