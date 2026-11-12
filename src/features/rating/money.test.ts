import { describe, expect, it } from "vite-plus/test";

import { formatPounds, ipt, monthlyPayment, storedMonthly } from "./money";

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
});
