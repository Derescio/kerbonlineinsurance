import { describe, expect, it } from "vite-plus/test";

import { getAuditEnv } from "#/server/env";

const key = Buffer.alloc(32, 7).toString("base64");

describe("getAuditEnv", () => {
  it("returns the parsed keys and the active version", () => {
    const keys = getAuditEnv({ AUDIT_HMAC_KEYS: `v1:${key}`, AUDIT_HMAC_ACTIVE_VERSION: "v1" });
    expect(keys.activeVersion).toBe("v1");
    expect(keys.keys.get("v1")).toHaveLength(32);
  });

  it("throws a message that names the setting group when the keys are missing", () => {
    expect(() => getAuditEnv({})).toThrow(/Audit \(4\.5b\).*missing/);
  });

  it("sees a changed active version after a valid call, so the cache doesn't hide it", () => {
    const source: Record<string, string | undefined> = {
      AUDIT_HMAC_KEYS: `v1:${key}`,
      AUDIT_HMAC_ACTIVE_VERSION: "v1",
    };
    getAuditEnv(source);
    source.AUDIT_HMAC_ACTIVE_VERSION = "v2";
    expect(() => getAuditEnv(source)).toThrow(/Audit \(4\.5b\)/);
  });

  it("never puts the key in the message", () => {
    const source = { AUDIT_HMAC_KEYS: `v1:${key.slice(0, 20)}`, AUDIT_HMAC_ACTIVE_VERSION: "v1" };
    expect(() => getAuditEnv(source)).toThrow(/Audit \(4\.5b\)/);
    try {
      getAuditEnv(source);
    } catch (e) {
      expect((e as Error).message).not.toContain(key.slice(0, 20));
    }
  });
});
