import { randomUUID } from "node:crypto";

import { asc } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Actor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog } from "#/server/db/schema";
import { AuditConfigError } from "#/server/env";
import { getOwnerDb, tamper, truncateAll } from "#/test/db";

import { audit, type AuditEntry } from "./audit";
import { AuditValueError, parseKeys } from "./chain";
import { verifyAuditChain } from "./verify";

// The chain end to end against real Postgres, running as kerb_app: rows link, concurrent writers
// keep one chain, and verification names the first row that was altered or whose link is broken.

const k1 = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const k2 = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const v1 = parseKeys(process.env.AUDIT_HMAC_KEYS, "v1");

function entry(extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: null,
    action: "claim.viewed",
    entityType: "claim",
    entityId: randomUUID(),
    ...extra,
  };
}

function write(e: AuditEntry = entry(), keys = v1) {
  return getDb().transaction((tx) => audit(tx, e, keys));
}

async function rows() {
  return getDb().select().from(auditLog).orderBy(asc(auditLog.id));
}

const verifyOwner = (keys = v1, options?: { batchSize?: number }) =>
  verifyAuditChain(getOwnerDb().$client, keys, options);

beforeEach(truncateAll);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(closeDb);

describe("audit()", () => {
  it("rolls back with the caller's transaction", async () => {
    await expect(
      getDb().transaction(async (tx) => {
        await audit(tx, entry(), v1);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await rows()).toHaveLength(0);
  });

  it("starts the chain with no prev_hash, then links each row to the one before", async () => {
    await write();
    await write();
    await write();
    const [a, b, c] = await rows();
    expect(a!.prevHash).toBeNull();
    expect(b!.prevHash).toBe(a!.hash);
    expect(c!.prevHash).toBe(b!.hash);
  });

  it("never moves created_at backwards", async () => {
    const first = await write();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(first.createdAt.getTime() - 60 * 60 * 1000));
    const second = await write();
    vi.useRealTimers();
    expect(second.createdAt.getTime()).toBe(first.createdAt.getTime());
    expect(await verifyOwner()).toMatchObject({ ok: true, rows: 2 });
  });

  it("keeps one chain under 20 concurrent writers", async () => {
    await Promise.all(Array.from({ length: 20 }, () => write()));
    const all = await rows();
    expect(all).toHaveLength(20);
    const last = all[19]!;
    expect(await verifyOwner()).toEqual({
      ok: true,
      rows: 20,
      lastId: last.id,
      lastHash: last.hash,
    });
  });

  it("records actor_role", async () => {
    const customer: Actor = { userId: "u-customer", customerId: "c1", staff: null };
    const staff: Actor = {
      userId: "u-staff",
      customerId: null,
      staff: {
        displayName: "S",
        roles: ["claims_handler", "admin"],
        permissions: new Set(),
      },
    };
    await write(entry({ actor: null }));
    await write(entry({ actor: customer }));
    await write(entry({ actor: staff }));
    const [a, b, c] = await rows();
    expect([a!.actorRole, a!.actorUserId]).toEqual([null, null]);
    expect([b!.actorRole, b!.actorUserId]).toEqual(["customer", "u-customer"]);
    expect([c!.actorRole, c!.actorUserId]).toEqual(["admin,claims_handler", "u-staff"]);
  });

  it("round-trips changes through jsonb", async () => {
    await write(
      entry({ changes: { roles: ["admin"], note: "Zoë 🚗", nested: { b: 1, a: null } } }),
    );
    expect(await verifyOwner()).toMatchObject({ ok: true, rows: 1 });
  });

  it("refuses an unchainable value before writing", async () => {
    await expect(write(entry({ changes: { x: 1.5 } }))).rejects.toBeInstanceOf(AuditValueError);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses to write without keys (fails closed)", async () => {
    // Malformed but key-like (too short), so there is key text that a leak would expose
    vi.stubEnv("AUDIT_HMAC_KEYS", "v1:AQEBAQEB");
    let thrown: unknown;
    try {
      await getDb().transaction((tx) => audit(tx, entry()));
    } catch (error) {
      thrown = error;
    }
    vi.unstubAllEnvs();
    expect(thrown).toBeInstanceOf(AuditConfigError);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Audit \(4\.5b\)/);
    expect(message).not.toContain("AQEBAQEB");
    expect(message).not.toContain(process.env.DATABASE_URL ?? "<unset>");
    expect(message).not.toContain("kerb_app:");
    expect(await rows()).toHaveLength(0);
  });
});

describe("verifyAuditChain", () => {
  async function five() {
    for (let i = 0; i < 5; i++) await write();
    return (await rows()).map((r) => r.id);
  }

  it("is ok on an empty table", async () => {
    expect(await verifyOwner()).toEqual({ ok: true, rows: 0, lastId: null, lastHash: null });
  });

  it("is ok on a clean chain", async () => {
    await five();
    expect(await verifyOwner()).toMatchObject({ ok: true, rows: 5 });
  });

  it("names an edited row as hash_mismatch", async () => {
    const [, , id3] = await five();
    await tamper("update audit_log set reason = 'edited' where id = $1", [id3]);
    const result = await verifyOwner();
    expect(result).toEqual({ ok: false, rowId: id3, reason: "hash_mismatch" });
    expect(typeof (result as { rowId: number }).rowId).toBe("number");
  });

  it("names the row after a deleted one as broken_link", async () => {
    const [, , id3, id4] = await five();
    await tamper("delete from audit_log where id = $1", [id3]);
    expect(await verifyOwner()).toEqual({ ok: false, rowId: id4, reason: "broken_link" });
  });

  it("carries the link check across batches", async () => {
    const [, , id3, id4] = await five();
    await tamper("delete from audit_log where id = $1", [id3]);
    expect(await verifyOwner(v1, { batchSize: 2 })).toEqual({
      ok: false,
      rowId: id4,
      reason: "broken_link",
    });
  });

  it("names an unknown key version", async () => {
    const [, id2] = await five();
    await tamper("update audit_log set key_version = 'v9' where id = $1", [id2]);
    expect(await verifyOwner()).toEqual({ ok: false, rowId: id2, reason: "unknown_key_version" });
  });

  it("names a first row that claims a predecessor as bad_genesis", async () => {
    const [id1] = await five();
    await tamper("update audit_log set prev_hash = repeat('a', 64) where id = $1", [id1]);
    expect(await verifyOwner()).toEqual({ ok: false, rowId: id1, reason: "bad_genesis" });
  });
});

describe("rotation", () => {
  it("keeps old rows verifying under the old key", async () => {
    const v2 = parseKeys(`v1:${k1},v2:${k2}`, "v2");
    await write(entry(), v1);
    await write(entry(), v1);
    const before = await rows();
    await write(entry(), v2);
    await write(entry(), v2);
    const after = await rows();

    expect(after.map((r) => r.keyVersion)).toEqual(["v1", "v1", "v2", "v2"]);
    expect(after.slice(0, 2).map((r) => r.hash)).toEqual(before.map((r) => r.hash));
    expect(await verifyOwner(v2)).toMatchObject({ ok: true, rows: 4 });
    expect(await verifyOwner(parseKeys(`v2:${k2}`, "v2"))).toEqual({
      ok: false,
      rowId: after[0]!.id,
      reason: "unknown_key_version",
    });
  });
});
