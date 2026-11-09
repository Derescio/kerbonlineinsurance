import { z } from "zod";

import type { Db } from "#/server/data/job-rows";
import { dayKey } from "#/server/jobs/backoff";
import type { HandlerResult, JobRow } from "#/server/jobs/types";
import { getObjectStore, type ObjectStore } from "#/server/uploads/store";

import type { Queryable } from "./verify";

// The daily audit anchor (4.11, spec calls 11 and 12; 4.5 decision 4). The chain proves no row
// was altered, inserted or removed from the middle, but deleting the newest rows, or rolling the
// database back, leaves a valid chain (4.5b decision 6). So once a day the newest row's id and
// hash go to R2 as `audit-anchors/YYYY-MM-DD.json`, under a bucket lock rule that refuses any
// overwrite or delete for 365 days (decision 3). verifyAgainstAnchors then checks every anchored
// row is still in the database with the same hash.
//
// Each anchor also records its chain's first hash. A rebuilt database (dev's `db:reset-dev`) starts
// a new chain whose ids repeat, and its old anchors stay locked for a year: those are set aside and
// counted, not failed. A restore of the same chain keeps its first row, so its anchors still count.

export const ANCHOR_PREFIX = "audit-anchors/";

const anchorSchema = z.object({
  lastId: z.number().int().positive(),
  lastHash: z.string(),
  keyVersion: z.string(),
  genesisHash: z.string(),
  anchoredAt: z.string(),
});

/** The chain's first row's hash: which chain an anchor belongs to */
async function genesisHash(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ hash: string }>(
    "select hash from audit_log order by id asc limit 1",
  );
  return rows[0]?.hash ?? null;
}

// A function declaration: handlers.ts reads it through an import cycle (see jobs/handlers.ts)
export async function anchorHandler(_job: JobRow, { db }: { db: Db }): Promise<HandlerResult> {
  // The real clock, not the run's `now`: a run with NOW= set must never write (and lock for a
  // year) a future day's anchor
  const now = new Date();
  const { rows } = await db.$client.query<{ id: string; hash: string; key_version: string }>(
    "select id, hash, key_version from audit_log order by id desc limit 1",
  );
  const newest = rows[0];
  if (!newest) return { skipped: "nothing to anchor" };

  const store = getObjectStore();
  const key = `${ANCHOR_PREFIX}${dayKey(now)}.json`;
  // A retry after the write, or a second run the same day: the lock would refuse an overwrite
  if (await store.head(key)) return { skipped: "already anchored" };
  const anchor = {
    lastId: Number(newest.id),
    lastHash: newest.hash,
    keyVersion: newest.key_version,
    genesisHash: await genesisHash(db.$client),
    anchoredAt: now.toISOString(),
  };
  await store.putObject(key, JSON.stringify(anchor), "application/json");
}

export type AnchorCheck =
  | {
      ok: true;
      anchors: number;
      /** Anchors of an earlier chain (a rebuilt database), set aside */
      otherChains: number;
    }
  | {
      ok: false;
      /** The anchor's object key, never a hash */
      anchor: string;
      reason: "anchor_unreadable" | "anchor_row_missing" | "anchor_hash_mismatch";
    };

/**
 * Every anchor of this chain must still find its row with the hash it had; names the first that
 * doesn't. Anchors of another chain are counted in `otherChains`.
 */
export async function verifyAgainstAnchors(
  db: Queryable,
  store: Pick<ObjectStore, "list" | "getText">,
): Promise<AnchorCheck> {
  const keys = await store.list(ANCHOR_PREFIX);
  const genesis = await genesisHash(db);
  let anchors = 0;
  let otherChains = 0;
  for (const key of keys) {
    let anchor: z.infer<typeof anchorSchema>;
    try {
      anchor = anchorSchema.parse(JSON.parse((await store.getText(key)) ?? ""));
    } catch {
      return { ok: false, anchor: key, reason: "anchor_unreadable" };
    }
    if (anchor.genesisHash !== genesis) {
      otherChains++;
      continue;
    }
    const { rows } = await db.query<{ hash: string }>("select hash from audit_log where id = $1", [
      anchor.lastId,
    ]);
    if (!rows[0]) return { ok: false, anchor: key, reason: "anchor_row_missing" };
    if (rows[0].hash !== anchor.lastHash) {
      return { ok: false, anchor: key, reason: "anchor_hash_mismatch" };
    }
    anchors++;
  }
  return { ok: true, anchors, otherChains };
}
