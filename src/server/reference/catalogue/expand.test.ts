import { describe, expect, it } from "vite-plus/test";

import { CatalogueError, expandCatalogue, valuePence } from "./expand";
import type { MakeSource } from "./types";

describe("valuePence", () => {
  // Standard curve, age 3 (2026 − 2023): £20,000 × 0.57 = £11,400
  it("applies the standard curve", () => {
    expect(valuePence(2_000_000, 2023, "standard")).toBe(1_140_000);
  });

  // Standard, age 8: 0.44 × 0.90³ = 0.32076; £20,000 × 0.32076 = £6,415.20 → nearest £50 = £6,400
  it("depreciates 10% a year after year 5 and rounds to £50", () => {
    expect(valuePence(2_000_000, 2018, "standard")).toBe(640_000);
  });

  // Electric, age 2: £40,000 × 0.55 = £22,000
  it("applies the electric curve", () => {
    expect(valuePence(4_000_000, 2024, "electric")).toBe(2_200_000);
  });

  // Prestige, age 6: 0.60 × 0.93 = 0.558; £100,000 × 0.558 = £55,800
  it("applies the prestige curve", () => {
    expect(valuePence(10_000_000, 2020, "prestige")).toBe(5_580_000);
  });

  // Standard, age 14: 0.44 × 0.90⁹ = 0.17047; £5,000 × 0.17047 = £852 → £850 → floor £1,000
  it("never goes below the floor", () => {
    expect(valuePence(500_000, 2012, "standard")).toBe(100_000);
  });

  // Age 0: £20,000 × 0.92 = £18,400
  it("prices a new car below list", () => {
    expect(valuePence(2_000_000, 2026, "standard")).toBe(1_840_000);
  });
});

const variant = {
  fuelType: "petrol",
  transmission: "manual",
  doors: 5,
  engineCc: 999,
  powerBhp: 100,
  insuranceGroup: 10,
  newPricePence: 2_000_000,
} as const;

function make(variants: MakeSource["generations"][number]["variants"], years: [number, number]) {
  return [
    {
      make: "Testmake",
      generations: [
        {
          model: "Hatch",
          bodyStyle: "hatchback",
          curve: "standard",
          years,
          groupSource: "test",
          variants,
        },
      ],
    },
  ] satisfies MakeSource[];
}

describe("expandCatalogue", () => {
  it("makes one row per variant per year, narrowed by a variant's own years", () => {
    const rows = expandCatalogue(
      make(
        [
          { ...variant, name: "1.0 S" },
          { ...variant, name: "1.0 SE", years: [2020, 2021] },
        ],
        [2019, 2021],
      ),
    );
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.variant === "1.0 SE" && r.year === 2019)).toBeUndefined();
    expect(rows[0]).toEqual({
      make: "Testmake",
      model: "Hatch",
      year: 2019,
      variant: "1.0 S",
      bodyStyle: "hatchback",
      fuelType: "petrol",
      transmission: "manual",
      doors: 5,
      engineCc: 999,
      powerBhp: 100,
      insuranceGroup: 10,
      // Standard, age 7: 0.44 × 0.90² = 0.3564 → £7,128 → £7,150
      valuePence: 715_000,
    });
  });

  it("refuses a duplicate variant, naming it", () => {
    expect(() =>
      expandCatalogue(
        make(
          [
            { ...variant, name: "1.0 S" },
            { ...variant, name: "1.0 S" },
          ],
          [2019, 2020],
        ),
      ),
    ).toThrow(new CatalogueError("Testmake Hatch 1.0 S 2019 is listed twice"));
  });

  it("refuses years outside 2012 to 2026", () => {
    expect(() => expandCatalogue(make([{ ...variant, name: "1.0 S" }], [2010, 2013]))).toThrow(
      CatalogueError,
    );
  });

  it("refuses an electric car with an engine size", () => {
    expect(() =>
      expandCatalogue(make([{ ...variant, name: "EV", fuelType: "electric" }], [2020, 2020])),
    ).toThrow(CatalogueError);
  });
});
