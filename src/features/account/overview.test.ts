import { describe, expect, it } from "vite-plus/test";

import { greetingLine, isCovered, isHeld, overviewStats, rowStatus } from "./overview-model";
import { policy } from "./overview.fixtures";

// The Overview's sums and labels (6.1, decisions 3–5). "Held" is active (or starting later) or
// lapsed; cancelled and ended policies don't count.

const today = "2026-11-18";

describe("isHeld and isCovered", () => {
  it("holds an active policy, and one starting later, and both are cover", () => {
    for (const p of [policy(), policy({ startsOn: "2026-12-01", endsOn: "2027-11-30" })]) {
      expect(isHeld(p, today)).toBe(true);
      expect(isCovered(p, today)).toBe(true);
    }
  });
  it("holds a lapsed policy, but it isn't cover", () => {
    const lapsed = policy({ status: "lapsed" });
    expect(isHeld(lapsed, today)).toBe(true);
    expect(isCovered(lapsed, today)).toBe(false);
  });
  it("holds neither a cancelled policy nor one that has ended", () => {
    for (const p of [
      policy({ status: "cancelled" }),
      policy({ startsOn: "2025-01-01", endsOn: "2025-12-31" }),
    ]) {
      expect(isHeld(p, today)).toBe(false);
      expect(isCovered(p, today)).toBe(false);
    }
  });
});

describe("overviewStats", () => {
  it("counts held policies and sums their yearly premiums, with a whole bundle's saving", () => {
    const bundle = { id: "b1", savingPence: 9_600 };
    const stats = overviewStats(
      [
        policy({ id: "car", bundle, annualPremiumPence: 53_640 }),
        policy({ id: "home", product: "home", bundle, annualPremiumPence: 54_780 }),
        policy({ id: "old", status: "cancelled", annualPremiumPence: 40_000 }),
      ],
      today,
    );
    expect(stats).toEqual({ held: 2, yearPence: 108_420, bundleSavingPence: 9_600 });
  });
  it("leaves out a bundle's saving once half of it is cancelled", () => {
    const bundle = { id: "b1", savingPence: 9_600 };
    const stats = overviewStats(
      [
        policy({ id: "car", bundle }),
        policy({ id: "home", product: "home", bundle, status: "cancelled" }),
      ],
      today,
    );
    expect(stats).toEqual({ held: 1, yearPence: 53_640, bundleSavingPence: 0 });
  });
});

describe("rowStatus", () => {
  it("says Active and when it renews: the day after cover ends", () => {
    expect(rowStatus(policy(), today)).toEqual({
      tone: "success",
      label: "Active",
      date: "Renews 14 Mar 2027",
    });
  });
  it("says when a policy starts later", () => {
    expect(rowStatus(policy({ startsOn: "2026-12-01", endsOn: "2027-11-30" }), today)).toEqual({
      tone: "success",
      label: "Starts 1 Dec",
      date: "Renews 1 Dec 2027",
    });
  });
  it("says Lapsed, in the warning style, with no date", () => {
    expect(rowStatus(policy({ status: "lapsed" }), today)).toEqual({
      tone: "warning",
      label: "Lapsed",
      date: null,
    });
  });
  it("says Cancelled, or Ended with the date", () => {
    expect(rowStatus(policy({ status: "cancelled" }), today)).toEqual({
      tone: "neutral",
      label: "Cancelled",
      date: null,
    });
    expect(rowStatus(policy({ startsOn: "2025-01-01", endsOn: "2025-12-31" }), today)).toEqual({
      tone: "neutral",
      label: "Ended",
      date: "Ended 31 Dec 2025",
    });
  });
});

describe("greetingLine", () => {
  it("is the weekday, day and month in London", () => {
    expect(greetingLine(new Date("2026-11-18T09:00:00Z"))).toBe("Wednesday 18 November");
    // Already Thursday in London (summer time) while UTC is still on Wednesday
    expect(greetingLine(new Date("2026-07-01T23:30:00Z"))).toBe("Thursday 2 July");
  });
});
