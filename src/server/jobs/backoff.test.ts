import { describe, expect, it } from "vite-plus/test";

import { dayKey, MAX_ATTEMPTS, nextRunAfter } from "./backoff";

const HOUR = 60 * 60 * 1000;
const t = new Date("2026-11-09T12:00:00Z");

describe("nextRunAfter", () => {
  it("waits 6, 12, 24 then 48 hours after attempts 1 to 4", () => {
    expect([1, 2, 3, 4].map((n) => nextRunAfter(n, t)!.getTime() - t.getTime())).toEqual([
      6 * HOUR,
      12 * HOUR,
      24 * HOUR,
      48 * HOUR,
    ]);
  });

  it("gives up after the 5th attempt", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(nextRunAfter(5, t)).toBeNull();
    expect(nextRunAfter(6, t)).toBeNull();
  });
});

describe("dayKey", () => {
  it("is the UTC date", () => {
    expect(dayKey(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-09");
    expect(dayKey(new Date("2026-11-10T00:10:00+01:00"))).toBe("2026-11-09");
  });
});
