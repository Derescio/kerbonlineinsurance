import { describe, expect, it } from "vite-plus/test";

import { policyEndDate } from "#/features/quote/policy-terms";

import {
  annualSettlement,
  daysBetween,
  emailPriceLine,
  instalmentChange,
  priceLine,
} from "./money";

// A policy from 1 Dec 2026, its last day of cover 30 Nov 2027 as purchase stores it (365 days of
// cover); 19 Sep 2027 leaves 73 of them, today included
const STARTS = "2026-12-01";
const ENDS = policyEndDate(STARTS);
const TODAY = "2027-09-19";

describe("daysBetween", () => {
  it("counts the days from one date to another", () => {
    expect(daysBetween(STARTS, "2027-12-01")).toBe(365);
    expect(daysBetween(TODAY, "2027-12-01")).toBe(73);
  });

  it("counts 366 days across a leap year's February", () => {
    expect(daysBetween("2027-12-01", "2028-12-01")).toBe(366);
  });
});

describe("annualSettlement", () => {
  it("charges £24.00 for £120 more with 73 of 365 days left", () => {
    expect(annualSettlement(12_000, TODAY, STARTS, ENDS)).toEqual({ kind: "charge", pence: 2_400 });
  });

  it("refunds a decrease", () => {
    expect(annualSettlement(-12_000, TODAY, STARTS, ENDS)).toEqual({
      kind: "refund",
      pence: 2_400,
    });
  });

  it("still charges for the last day of cover", () => {
    // £365 more on 30 Nov 2027: one day of 365
    expect(annualSettlement(36_500, ENDS, STARTS, ENDS)).toEqual({ kind: "charge", pence: 100 });
  });

  it("charges no more than the year's difference before cover starts", () => {
    expect(annualSettlement(12_000, "2026-11-20", STARTS, ENDS)).toEqual({
      kind: "charge",
      pence: 12_000,
    });
  });

  it("is none when nothing changes", () => {
    expect(annualSettlement(0, TODAY, STARTS, ENDS)).toEqual({ kind: "none", pence: 0 });
  });

  it("uses 366 term days in a leap-year term", () => {
    // 1 Dec 2027 to 30 Nov 2028; 1 Jun 2028 leaves 183 days
    expect(
      annualSettlement(36_600, "2028-06-01", "2027-12-01", policyEndDate("2027-12-01")),
    ).toEqual({
      kind: "charge",
      pence: 18_300,
    });
  });
});

describe("instalmentChange", () => {
  it("adds £13.20 to each of 2 instalments for £120 more, 73/365 days, credit rate 0.1", () => {
    expect(instalmentChange(12_000, TODAY, STARTS, ENDS, 0.1, 2)).toBe(1_320);
  });

  it("rounds toward zero, so the instalments never add up to more than the difference", () => {
    // £10 more, 100 of 365 days, 3 left: 301.37p owed, so 100p each
    const each = instalmentChange(1_000, "2027-08-23", STARTS, ENDS, 0.1, 3);
    expect(each).toBe(100);
    const down = instalmentChange(-1_000, "2027-08-23", STARTS, ENDS, 0.1, 3);
    expect(down).toBe(-100);
  });

  it("changes nothing when no instalments are left", () => {
    expect(instalmentChange(12_000, TODAY, STARTS, ENDS, 0.1, 0)).toBe(0);
  });
});

describe("priceLine", () => {
  it("words a monthly change by the month", () => {
    expect(priceLine("monthly", 460, "up")).toBe("Your price goes up by £4.60 a month");
    expect(priceLine("monthly", 230, "down")).toBe("Your price goes down by £2.30 a month");
    expect(priceLine("monthly", 0, "same")).toBe("Your price stays the same");
  });

  it("words an annual change as a payment or a refund", () => {
    expect(priceLine("annual", 3_840, "up")).toBe("You'll pay £38.40 now for the rest of the year");
    expect(priceLine("annual", 2_110, "down")).toBe("We'll refund £21.10 to your card");
    expect(priceLine("annual", 0, "same")).toBe("Your price stays the same");
  });
});

describe("emailPriceLine", () => {
  it("says what was paid or refunded, once it has been", () => {
    expect(emailPriceLine("annual", "charge", 26_927)).toBe(
      "You paid £269.27 for the rest of the year",
    );
    expect(emailPriceLine("annual", "refund", 7_643)).toBe("We've refunded £76.43 to your card");
    expect(emailPriceLine("annual", "none", 0)).toBe("Your price stays the same");
  });

  it("words a monthly change as the dialog did: it's the payments to come", () => {
    expect(emailPriceLine("monthly", "instalments", 460)).toBe(
      "Your price goes up by £4.60 a month",
    );
    expect(emailPriceLine("monthly", "instalments", -230)).toBe(
      "Your price goes down by £2.30 a month",
    );
    expect(emailPriceLine("monthly", "none", 0)).toBe("Your price stays the same");
  });
});
