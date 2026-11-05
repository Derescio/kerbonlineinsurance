import { describe, expect, it } from "vite-plus/test";

import {
  AUDIT_FORMAT,
  AUDIT_LOCK_KEY,
  AuditKeyError,
  AuditValueError,
  assertChainable,
  canonicalPayload,
  computeHash,
  nextCreatedAt,
  parseKeys,
  type ChainRow,
} from "./chain.ts";

const keyA = Buffer.alloc(32, 1);
const keyB = Buffer.alloc(32, 2);

const row: ChainRow = {
  prevHash: "a".repeat(64),
  keyVersion: "v1",
  createdAt: new Date("2026-11-05T10:00:00.123Z"),
  actorUserId: "user_1",
  actorRole: "admin,claims_handler",
  action: "claim.status_changed",
  entityType: "claim",
  entityId: "42",
  changes: { status: { from: "open", to: "closed" } },
  reason: "duplicate",
  requestId: "req_1",
  ipHash: "b".repeat(64),
};

describe("constants", () => {
  it("are fixed", () => {
    expect(AUDIT_FORMAT).toBe(1);
    expect(AUDIT_LOCK_KEY).toBe(1801810530);
  });
});

describe("canonicalPayload", () => {
  it("does not depend on key order at any depth", () => {
    const a = canonicalPayload({ ...row, changes: { b: 1, a: { d: true, c: null } } });
    const b = canonicalPayload({ ...row, changes: { a: { c: null, d: true }, b: 1 } });
    expect(a).toBe(b);
  });

  it("writes createdAt as an ISO string with milliseconds", () => {
    expect(canonicalPayload(row)).toContain('"2026-11-05T10:00:00.123Z"');
  });

  it("starts with the format", () => {
    expect(canonicalPayload(row).startsWith("[1,")).toBe(true);
  });

  it("writes absent values as null", () => {
    const payload = JSON.parse(
      canonicalPayload({
        ...row,
        prevHash: null,
        actorUserId: null,
        actorRole: null,
        changes: null,
        reason: null,
        requestId: null,
        ipHash: null,
      }),
    ) as unknown[];
    expect(payload).toEqual([
      1,
      null,
      "v1",
      "2026-11-05T10:00:00.123Z",
      null,
      null,
      "claim.status_changed",
      "claim",
      "42",
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("computeHash", () => {
  it("is 64 lowercase hex characters and stable", () => {
    const h = computeHash(row, keyA);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash(row, keyA)).toBe(h);
  });

  it("depends on the key", () => {
    expect(computeHash(row, keyA)).not.toBe(computeHash(row, keyB));
  });

  const changed: [string, ChainRow][] = [
    ["prevHash", { ...row, prevHash: "c".repeat(64) }],
    ["keyVersion", { ...row, keyVersion: "v2" }],
    ["createdAt", { ...row, createdAt: new Date(row.createdAt.getTime() + 1) }],
    ["actorUserId", { ...row, actorUserId: "user_2" }],
    ["actorRole", { ...row, actorRole: "customer" }],
    ["action", { ...row, action: "claim.viewed" }],
    ["entityType", { ...row, entityType: "referral" }],
    ["entityId", { ...row, entityId: "43" }],
    ["changes", { ...row, changes: { status: { from: "open", to: "paid" } } }],
    ["reason", { ...row, reason: "other" }],
    ["requestId", { ...row, requestId: "req_2" }],
    ["ipHash", { ...row, ipHash: "d".repeat(64) }],
  ];
  it.each(changed)("changes when %s changes", (_field, other) => {
    expect(computeHash(other, keyA)).not.toBe(computeHash(row, keyA));
  });
});

describe("assertChainable", () => {
  const bad: [string, Partial<ChainRow>][] = [
    ["float", { changes: { x: 1.5 } }],
    ["NaN", { changes: { x: Number.NaN } }],
    ["unsafe integer", { changes: { x: 2 ** 53 } }],
    ["undefined", { changes: { x: undefined as never } }],
    ["Date", { changes: { x: new Date() as never } }],
    ["NUL in value", { changes: { x: "a\u0000b" } }],
    ["lone surrogate", { changes: { x: "\ud800" } }],
    ["NUL in reason", { reason: "a\u0000b" }],
  ];
  it.each(bad)("refuses %s", (_name, patch) => {
    let thrown: unknown;
    try {
      assertChainable({ ...row, ...patch });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuditValueError);
    const err = thrown as AuditValueError;
    expect(err.name).toBe("AuditValueError");
    expect(err.field.length).toBeGreaterThan(0);
    expect(err.message).toContain(err.field);
    expect(err.message).not.toContain("a\u0000b");
    expect(err.message).not.toContain("1.5");
  });

  it("accepts nested arrays, negatives, emoji and null", () => {
    expect(() =>
      assertChainable({
        ...row,
        changes: { roles: ["admin"], n: -3, s: "Zoë 🚗", o: { k: null } },
      }),
    ).not.toThrow();
  });
});

describe("parseKeys", () => {
  const b64 = Buffer.alloc(32, 7).toString("base64");
  const b64b = Buffer.alloc(32, 9).toString("base64");

  it("trims entries and parses several versions", () => {
    const keys = parseKeys(` v1:${b64} , v2:${b64b}\n`, "v2");
    expect(keys.activeVersion).toBe("v2");
    expect(keys.keys.size).toBe(2);
    expect(keys.keys.get("v1")?.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  const refused: [string, string | undefined, string | undefined, string][] = [
    ["undefined", undefined, "v1", "missing"],
    ["empty", "", "v1", "missing"],
    ["trailing comma", `v1:${b64},`, "v1", "malformed"],
    ["no colon", `v1${b64}`, "v1", "malformed"],
    ["bad version", `x1:${b64}`, "x1", "malformed"],
    ["base64url", `v1:${Buffer.alloc(32, 0xfb).toString("base64url")}`, "v1", "malformed"],
    ["short key", `v1:${Buffer.alloc(31, 1).toString("base64")}`, "v1", "short_key"],
    ["duplicate version", `v1:${b64},v1:${b64}`, "v1", "duplicate_version"],
    ["unlisted active", `v1:${b64}`, "v3", "unknown_active_version"],
    ["missing active", `v1:${b64}`, undefined, "missing"],
  ];
  it.each(refused)("refuses %s", (_name, raw, active, reason) => {
    let thrown: unknown;
    try {
      parseKeys(raw, active);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuditKeyError);
    const err = thrown as AuditKeyError;
    expect(err.name).toBe("AuditKeyError");
    expect(err.reason).toBe(reason);
    expect(err.message).not.toContain(b64);
    expect(err.message).not.toContain(b64b);
  });
});

describe("nextCreatedAt", () => {
  const now = new Date("2026-11-05T10:00:00.000Z");
  it("uses now with no previous row", () => {
    expect(nextCreatedAt(null, now)).toEqual(now);
  });
  it("keeps a later previous row's time", () => {
    const later = new Date("2026-11-05T10:00:05.000Z");
    expect(nextCreatedAt(later, now)).toEqual(later);
  });
  it("uses now when the previous row is earlier", () => {
    const earlier = new Date("2026-11-05T09:59:00.000Z");
    expect(nextCreatedAt(earlier, now)).toEqual(now);
  });
});
