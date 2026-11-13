import { describe, expect, it } from "vite-plus/test";

import { formatPounds, ipt, monthlyPayment, representativeApr, storedMonthly } from "./money";

describe("money", () => {
  it("spreads a total with IPT over 12 payments, 10% more", () => {
    // 45840 × 1.10 = 50424; ÷ 12 = 4202 → "12 payments of £42.02" for £458.40
    expect(monthlyPayment(45_840, 0.1)).toBe(4_202);
  });

  it("stores the monthly figure before IPT, as 4.2 defines the column", () => {
    // 63000 × 1.10 = 69300; ÷ 12 = 5775
    expect(storedMonthly(63_000, 0.1)).toBe(5_775);
  });

  it("rounds IPT once, half up", () => {
    // 30666 × 0.12 = 3679.92 → 3680; 15334 × 0.12 = 1840.08 → 1840; 12500 × 0.12 = 1500
    expect(ipt(30_666, 0.12)).toBe(3_680);
    expect(ipt(15_334, 0.12)).toBe(1_840);
    expect(ipt(12_500, 0.12)).toBe(1_500);
  });

  it("formats pence as pounds", () => {
    expect(formatPounds(123_456)).toBe("£1,234.56");
    expect(formatPounds(4_202)).toBe("£42.02");
    expect(formatPounds(45_840)).toBe("£458.40");
  });

  it("works out the representative APR with the first payment at the start (5.5, decision 8)", () => {
    // £458.40 is 12 payments of £42.02, at 0, 1, … 11 months. By hand, at 1.7824% a month the 12
    // payments are worth 4202 × (1 − 1.017824^−12) ÷ (0.017824 ÷ 1.017824) = 45840 today, and
    // 1.017824^12 − 1 = 23.61%
    expect(representativeApr(45_840, 4_202)).toBe(23.6);
    expect(representativeApr(175_379, monthlyPayment(175_379, 0.1))).toBe(23.6);
  });

  it("is 0% when paying monthly costs nothing more", () => {
    expect(representativeApr(120_000, 10_000)).toBe(0);
  });
});
