import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook } from "vitest-browser-react";

import { useIdempotencyKey } from "./writes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("useIdempotencyKey", () => {
  it("keeps the key across rerender and remount with one scope", async () => {
    const first = await renderHook(() => useIdempotencyKey("quote"));
    const key = first.result.current.key;
    expect(key).toMatch(UUID);
    await first.rerender();
    expect(first.result.current.key).toBe(key);
    await first.unmount();
    const second = await renderHook(() => useIdempotencyKey("quote"));
    expect(second.result.current.key).toBe(key);
  });

  it("gives different scopes different keys", async () => {
    const a = await renderHook(() => useIdempotencyKey("a"));
    const b = await renderHook(() => useIdempotencyKey("b"));
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it("rotates, and a remount reads the new key", async () => {
    const first = await renderHook(() => useIdempotencyKey("quote"));
    const old = first.result.current.key;
    await first.act(() => first.result.current.rotate());
    const rotated = first.result.current.key;
    expect(rotated).toMatch(UUID);
    expect(rotated).not.toBe(old);
    await first.unmount();
    const second = await renderHook(() => useIdempotencyKey("quote"));
    expect(second.result.current.key).toBe(rotated);
  });

  it("falls back to memory when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const hook = await renderHook(() => useIdempotencyKey("quote"));
    const old = hook.result.current.key;
    expect(old).toMatch(UUID);
    await hook.act(() => hook.result.current.rotate());
    expect(hook.result.current.key).toMatch(UUID);
    expect(hook.result.current.key).not.toBe(old);
  });

  it("replaces a stored value that is not a UUID", async () => {
    sessionStorage.setItem("kerb:idempotency:quote", "not-a-uuid");
    const hook = await renderHook(() => useIdempotencyKey("quote"));
    expect(hook.result.current.key).toMatch(UUID);
    expect(sessionStorage.getItem("kerb:idempotency:quote")).toBe(hook.result.current.key);
  });
});
