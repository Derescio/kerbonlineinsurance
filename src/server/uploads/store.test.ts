import { describe, expect, it } from "vite-plus/test";

import { r2Origin } from "./origin";
import { MemoryObjectStore } from "./store-memory";
import { R2ObjectStore } from "./store-r2";

// The object stores (4.10, call 13). The R2 one is checked offline here, by the links it signs;
// `vp run uploads:check-r2` proves it against the real bucket.

const ACCOUNT = "a".repeat(32);
const r2 = new R2ObjectStore({
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET: "kerb-dev",
});

describe("r2Origin", () => {
  it("is the account's endpoint, and null for anything else", () => {
    expect(r2Origin(ACCOUNT)).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(r2Origin(undefined)).toBeNull();
    expect(r2Origin("")).toBeNull();
    expect(r2Origin("*")).toBeNull();
    expect(r2Origin("evil.example.com/")).toBeNull();
  });
});

describe("R2ObjectStore", () => {
  it("signs a 5-minute PUT with the type and length, path-style, with no checksum", async () => {
    const url = new URL(
      await r2.presignPut("claim_photo/u1/f1.webp", {
        contentType: "image/webp",
        contentLength: 1234,
      }),
    );
    expect(url.origin).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe("/kerb-dev/claim_photo/u1/f1.webp");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
    expect([...url.searchParams.keys()].join(" ").toLowerCase()).not.toContain("checksum");
  });

  it("signs a 5-minute GET", async () => {
    const url = new URL(await r2.presignGet("claim_photo/u1/f1.webp"));
    expect(url.pathname).toBe("/kerb-dev/claim_photo/u1/f1.webp");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("MemoryObjectStore", () => {
  it("puts, heads, reads the first bytes and deletes", async () => {
    const store = new MemoryObjectStore();
    store.put("k", new Uint8Array([1, 2, 3, 4, 5]), "image/webp");
    expect(await store.head("k")).toEqual({ size: 5, contentType: "image/webp" });
    expect(await store.readFirstBytes("k", 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    await store.delete("k");
    expect(await store.head("k")).toBeNull();
    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("signs links that name the key", async () => {
    const store = new MemoryObjectStore();
    expect(await store.presignPut("a/b.webp")).toBe("memory://put/a/b.webp");
    expect(await store.presignGet("a/b.webp")).toBe("memory://get/a/b.webp");
  });

  it("can fail every delete", async () => {
    const store = new MemoryObjectStore();
    store.failDeletes = true;
    await expect(store.delete("k")).rejects.toThrow("R2 is down");
  });
});
