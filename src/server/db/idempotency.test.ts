import { describe, expect, it } from "vite-plus/test";

import { requestHash, toJson } from "./idempotency";

describe("toJson", () => {
  it("turns a Date into its ISO string and drops undefined keys", () => {
    expect(toJson({ at: new Date("2026-11-05T10:00:00.000Z"), gone: undefined })).toEqual({
      at: "2026-11-05T10:00:00.000Z",
    });
  });

  it("turns undefined into null", () => {
    expect(toJson(undefined)).toBeNull();
  });
});

describe("requestHash", () => {
  it("is 64 hex characters", () => {
    expect(requestHash("a", { x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order", () => {
    expect(requestHash("a", { x: 1, y: 2 })).toBe(requestHash("a", { y: 2, x: 1 }));
  });

  it("changes with the action or the payload", () => {
    const base = requestHash("a", { x: 1 });
    expect(requestHash("b", { x: 1 })).not.toBe(base);
    expect(requestHash("a", { x: 2 })).not.toBe(base);
  });
});
