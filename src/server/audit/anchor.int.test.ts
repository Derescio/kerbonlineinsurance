import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { jobs } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { enqueue } from "#/server/jobs/enqueue";
import { runJob } from "#/server/jobs/runner";
import type { JobDeps } from "#/server/jobs/types";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { tamper, truncateAll } from "#/test/db";

import { ANCHOR_PREFIX, verifyAgainstAnchors } from "./anchor";
import { audit } from "./audit";

// The daily audit anchor (4.11, spec calls 11 and 12): the newest row's id and hash written to R2,
// where the lock rule keeps it; verifyAgainstAnchors then catches the newest rows being deleted
// or a row being altered, which the chain alone can't (4.5b decision 6).

const now = new Date("2026-11-09T03:00:00Z");
const KEY = `${ANCHOR_PREFIX}2026-11-09.json`;
const deps: JobDeps = { sendEmail: async () => {}, defer: () => {} };
let store: MemoryObjectStore;

async function writeAuditRows(count: number) {
  for (let i = 0; i < count; i++) {
    await withTx(getDb(), (tx) =>
      audit(tx, { actor: null, action: "account.closed", entityId: `user-${i}` }),
    );
  }
}

const newest = async () =>
  (
    await getDb().$client.query<{ id: string; hash: string; key_version: string }>(
      "select id, hash, key_version from audit_log order by id desc limit 1",
    )
  ).rows[0]!;

async function anchorJob(key = "audit.anchor:2026-11-09") {
  const id = (await enqueue(getDb(), {
    type: "audit.anchor",
    payload: {},
    idempotencyKey: key,
    runAfter: now,
  }))!;
  await runJob(getDb(), id, deps, now);
  return (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
}

afterAll(closeDb);
beforeEach(async () => {
  await truncateAll();
  store = new MemoryObjectStore();
  setObjectStore(store);
});
afterEach(() => setObjectStore(null));

describe("audit.anchor", () => {
  it("writes the newest row's id, hash and key version", async () => {
    await writeAuditRows(3);
    const job = await anchorJob();
    expect(job).toMatchObject({ status: "done", lastError: null });
    const row = await newest();
    expect(JSON.parse((await store.getText(KEY))!)).toEqual({
      lastId: Number(row.id),
      lastHash: row.hash,
      keyVersion: row.key_version,
      anchoredAt: now.toISOString(),
    });
  });

  it("skips a second run the same day and leaves the anchor as it was", async () => {
    await writeAuditRows(1);
    await anchorJob();
    const first = await store.getText(KEY);
    await writeAuditRows(1);
    expect(await anchorJob("again")).toMatchObject({
      status: "done",
      lastError: "skipped: already anchored",
    });
    expect(await store.getText(KEY)).toBe(first);
  });

  it("skips an empty chain", async () => {
    expect(await anchorJob()).toMatchObject({
      status: "done",
      lastError: "skipped: nothing to anchor",
    });
    expect(await store.list(ANCHOR_PREFIX)).toEqual([]);
  });
});

describe("verifyAgainstAnchors", () => {
  it("passes when every anchored row is still there", async () => {
    await writeAuditRows(2);
    await anchorJob();
    await writeAuditRows(1);
    expect(await verifyAgainstAnchors(getDb().$client, store)).toEqual({ ok: true, anchors: 1 });
  });

  it("names a missing anchored row: the newest rows were deleted", async () => {
    await writeAuditRows(2);
    await anchorJob();
    await tamper("delete from audit_log where id = $1", [(await newest()).id]);
    expect(await verifyAgainstAnchors(getDb().$client, store)).toEqual({
      ok: false,
      anchor: KEY,
      reason: "anchor_row_missing",
    });
  });

  it("names an anchored row whose hash changed", async () => {
    await writeAuditRows(2);
    await anchorJob();
    await tamper("update audit_log set hash = repeat('b', 64) where id = $1", [
      (await newest()).id,
    ]);
    expect(await verifyAgainstAnchors(getDb().$client, store)).toEqual({
      ok: false,
      anchor: KEY,
      reason: "anchor_hash_mismatch",
    });
  });

  it("names an anchor that isn't readable", async () => {
    await store.putObject(KEY, "not json", "application/json");
    expect(await verifyAgainstAnchors(getDb().$client, store)).toEqual({
      ok: false,
      anchor: KEY,
      reason: "anchor_unreadable",
    });
  });
});
