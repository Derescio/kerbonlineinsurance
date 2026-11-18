import { describe, expect, it } from "vite-plus/test";

import { instalmentDates, paymentSchedule, policyEndDate, startDateBounds } from "./policy-terms";

describe("policyEndDate (5.6, decision 6)", () => {
  it("ends the day before the anniversary", () => {
    expect(policyEndDate("2026-03-15")).toBe("2027-03-14");
    expect(policyEndDate("2026-01-01")).toBe("2026-12-31");
  });

  it("treats the anniversary of 29 February as 1 March", () => {
    expect(policyEndDate("2028-02-29")).toBe("2029-02-28");
  });
});

describe("instalmentDates", () => {
  it("clamps the day to the end of the month", () => {
    expect(instalmentDates("2027-01-31", 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(instalmentDates("2028-01-31", 2)).toEqual(["2028-01-31", "2028-02-29"]);
  });

  it("rolls over the year", () => {
    expect(instalmentDates("2026-12-01", 2)).toEqual(["2026-12-01", "2027-01-01"]);
  });
});

describe("startDateBounds", () => {
  it("runs from today to 30 days on, defaulting to tomorrow", () => {
    expect(startDateBounds("2026-11-13")).toEqual({
      min: "2026-11-13",
      max: "2026-12-13",
      fallback: "2026-11-14",
    });
    expect(startDateBounds("2026-12-31")).toEqual({
      min: "2026-12-31",
      max: "2027-01-30",
      fallback: "2027-01-01",
    });
  });
});

describe("paymentSchedule", () => {
  it("is twelve payments of the monthly amount, monthly", () => {
    const rows = paymentSchedule("monthly", 50_000, 4_584, "2026-12-01");
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.amountPence === 4_584)).toBe(true);
    expect(rows[0]).toEqual({ instalmentNumber: 1, amountPence: 4_584, dueOn: "2026-12-01" });
    expect(rows[11]).toEqual({ instalmentNumber: 12, amountPence: 4_584, dueOn: "2027-11-01" });
  });

  it("is one payment of the total, annually", () => {
    expect(paymentSchedule("annual", 50_000, 4_584, "2026-12-01")).toEqual([
      { instalmentNumber: 1, amountPence: 50_000, dueOn: "2026-12-01" },
    ]);
  });

  it("puts a 31 January start on 28 or 29 February", () => {
    const rows = paymentSchedule("monthly", 50_000, 4_584, "2027-01-31");
    expect(rows[1]!.dueOn).toBe("2027-02-28");
    expect(rows[2]!.dueOn).toBe("2027-03-31");
    expect(rows[3]!.dueOn).toBe("2027-04-30");
  });
});
