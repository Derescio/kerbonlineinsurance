import { describe, expect, it } from "vite-plus/test";

import { addYears, ageOn, isoFromParts, todayIso, wholeYearsBetween } from "./dates";

describe("todayIso", () => {
  it("gives the London date", () => {
    expect(todayIso(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    // 23:30 UTC is 00:30 the next day in BST
    expect(todayIso(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("isoFromParts", () => {
  it("builds a real date", () => {
    expect(isoFromParts("5", "3", "1991")).toBe("1991-03-05");
    expect(isoFromParts(" 29", "02", "2024")).toBe("2024-02-29");
  });

  it("refuses dates that don't exist, short years and non-numbers", () => {
    expect(isoFromParts("31", "2", "2000")).toBeNull();
    expect(isoFromParts("29", "2", "2025")).toBeNull();
    expect(isoFromParts("1", "1", "99")).toBeNull();
    expect(isoFromParts("1", "13", "2000")).toBeNull();
    expect(isoFromParts("", "1", "2000")).toBeNull();
    expect(isoFromParts("1.5", "1", "2000")).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts whole years by calendar", () => {
    expect(ageOn("2009-11-11", "2026-11-11")).toBe(17);
    expect(ageOn("2009-11-12", "2026-11-11")).toBe(16);
  });

  it("treats a 29 February birthday as 28 February in other years", () => {
    expect(ageOn("2008-02-29", "2025-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2025-02-27")).toBe(16);
  });
});

describe("wholeYearsBetween", () => {
  it("counts whole years and never goes below 0", () => {
    expect(wholeYearsBetween("2020-05-01", "2026-04-30")).toBe(5);
    expect(wholeYearsBetween("2020-05-01", "2026-05-01")).toBe(6);
    expect(wholeYearsBetween("2027-01-01", "2026-01-01")).toBe(0);
  });
});

describe("addYears", () => {
  it("moves 29 February to 28 February in a common year", () => {
    expect(addYears("2008-02-29", 17)).toBe("2025-02-28");
    expect(addYears("2008-02-29", 16)).toBe("2024-02-29");
    expect(addYears("2021-11-11", 5)).toBe("2026-11-11");
    expect(addYears("2026-11-11", -5)).toBe("2021-11-11");
  });
});
