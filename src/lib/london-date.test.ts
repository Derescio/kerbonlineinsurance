import { describe, expect, it } from "vite-plus/test";

import { londonDate } from "./london-date";

describe("londonDate", () => {
  it("is already tomorrow in London late at night in summer", () => {
    expect(londonDate(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });
  it("matches UTC in winter", () => {
    expect(londonDate(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
});
