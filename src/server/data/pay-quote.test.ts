import { describe, expect, it } from "vite-plus/test";

import { hasExpired } from "./pay-quote";

// One expiry rule for pay and the reads (5.6): a quote is expired at the instant it's valid until
describe("hasExpired", () => {
  const until = new Date("2026-11-11T12:00:00Z");

  it("is live before the instant", () => {
    expect(hasExpired(until, new Date(until.getTime() - 1))).toBe(false);
  });

  it("is expired at the instant and after", () => {
    expect(hasExpired(until, until)).toBe(true);
    expect(hasExpired(until, new Date(until.getTime() + 1))).toBe(true);
  });
});
