import type { Product } from "#/server/db/schema/values";

// The spec's example people (4.8, call 22). 5.4's tests price each one with priceQuote() and check
// it lands in its target; a miss there is fixed with a v2, not by editing v1. Prices are annual, in
// pence, including IPT. `handPence` is the spec's hand calculation with the v1 numbers; the targets
// are the ranges the 2026 market research supports.

export type CalibrationExpectation =
  | { outcome: "quoted"; minPence: number; maxPence: number; handPence: number }
  | { outcome: "referred" | "declined"; reason: string };

export interface CalibrationPerson {
  id: string;
  product: Product;
  /** What the quote journey would collect, in the units the rating tables use */
  inputs: Record<string, unknown>;
  /** `lookup:key` pairs the inputs depend on, checked against the product's v1 lookups */
  lookupKeys: readonly string[];
  expected: CalibrationExpectation;
}

const vehicle = (
  make: string,
  model: string,
  year: number,
  variant: string,
  insuranceGroup: number,
) => ({
  make,
  model,
  year,
  variant,
  insuranceGroup,
});

export const CALIBRATION_PEOPLE: readonly CalibrationPerson[] = [
  {
    id: "C1",
    product: "car",
    inputs: {
      vehicle: vehicle("Ford", "Focus", 2019, "1.0 EcoBoost 125 Titanium 5dr", 14),
      driver: {
        age: 45,
        occupation: "teacher",
        licenceYears: 25,
        noClaimsYears: 12,
        pastClaims: 0,
      },
      postcodeArea: "LS",
      annualMileage: 8_000,
      usage: "commuting",
      overnightLocation: "driveway",
      voluntaryExcessPence: 25_000,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:teacher", "postcode_area:LS"],
    // 460 × 1.00 × 1.07 × 0.95 × 0.9785 × 0.97 × 0.95 = £421.62, + 12% IPT
    expected: { outcome: "quoted", minPence: 42_000, maxPence: 65_000, handPence: 47_221 },
  },
  {
    id: "C2",
    product: "car",
    inputs: {
      vehicle: vehicle("Ford", "Fiesta", 2018, "1.1 Zetec 5dr", 6),
      driver: { age: 19, occupation: "student", licenceYears: 1, noClaimsYears: 0, pastClaims: 0 },
      postcodeArea: "E",
      annualMileage: 6_000,
      usage: "social",
      overnightLocation: "street",
      voluntaryExcessPence: 0,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:student", "postcode_area:E"],
    // 460 × 2.00 × 1.55 × 1.08 × 0.8221 × 1.50 × 1.12 × 0.95 × 1.08 × 0.97 = £2,116.88, + IPT
    expected: { outcome: "quoted", minPence: 190_000, maxPence: 260_000, handPence: 237_091 },
  },
  {
    id: "C3",
    product: "car",
    inputs: {
      vehicle: vehicle("Toyota", "Yaris", 2016, "1.33 VVT-i Icon 5dr", 9),
      driver: {
        age: 67,
        occupation: "retired",
        licenceYears: 45,
        noClaimsYears: 15,
        pastClaims: 0,
      },
      postcodeArea: "EX",
      annualMileage: 4_000,
      usage: "social",
      overnightLocation: "garage",
      voluntaryExcessPence: 25_000,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:retired", "postcode_area:EX"],
    // 460 × 0.84 × 0.90 × 0.92 × 0.8776 × 0.95⁴ × 0.97 = £221.84, below the £225 minimum
    expected: { outcome: "quoted", minPence: 25_000, maxPence: 40_000, handPence: 25_200 },
  },
  {
    id: "C4",
    product: "car",
    inputs: {
      vehicle: vehicle("Tesla", "Model Y", 2023, "Long Range AWD", 40),
      driver: {
        age: 35,
        occupation: "software_developer",
        licenceYears: 15,
        noClaimsYears: 8,
        pastClaims: 0,
      },
      postcodeArea: "BS",
      annualMileage: 12_000,
      usage: "commuting",
      overnightLocation: "driveway",
      voluntaryExcessPence: 25_000,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:software_developer", "postcode_area:BS"],
    // 460 × 1.06 × 1.07 × 0.92 × 1.7229 × 1.08 × 1.01 × 1.04 × 0.97 × 0.95 = £864.51, + IPT
    expected: { outcome: "quoted", minPence: 80_000, maxPence: 130_000, handPence: 96_825 },
  },
  {
    id: "C5",
    product: "car",
    inputs: {
      vehicle: vehicle("BMW", "3 Series", 2021, "M3 Competition", 50),
      driver: {
        age: 22,
        occupation: "sales_assistant",
        licenceYears: 4,
        noClaimsYears: 3,
        pastClaims: 0,
      },
      postcodeArea: "M",
      annualMileage: 8_000,
      usage: "social",
      overnightLocation: "street",
      voluntaryExcessPence: 0,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:sales_assistant", "postcode_area:M"],
    // Under 25 with group 40+
    expected: { outcome: "declined", reason: "young_driver_high_group" },
  },
  {
    id: "C6",
    product: "car",
    inputs: {
      vehicle: vehicle("Porsche", "911", 2020, "Carrera S", 50),
      driver: {
        age: 52,
        occupation: "solicitor",
        licenceYears: 34,
        noClaimsYears: 20,
        pastClaims: 0,
      },
      postcodeArea: "GU",
      annualMileage: 6_000,
      usage: "social",
      overnightLocation: "garage",
      voluntaryExcessPence: 50_000,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["occupation:solicitor", "postcode_area:GU"],
    // Group 45+
    expected: { outcome: "referred", reason: "high_insurance_group" },
  },
  {
    id: "H1",
    product: "home",
    inputs: {
      postcodeArea: "LS",
      propertyType: "semi",
      yearBuilt: 1965,
      bedrooms: 3,
      rebuildCostPence: 24_000_000,
      contentsValuePence: 4_500_000,
      hasAlarm: false,
      hasSmokeAlarm: true,
      lockType: "multipoint",
      pastClaims: 0,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["postcode_area:LS"],
    // buildings 240 × 0.75 × 1.03 = £185.40; contents 45 × 1.90 × 1.15 × 0.95 = £93.41; + IPT
    expected: { outcome: "quoted", minPence: 25_000, maxPence: 40_000, handPence: 31_227 },
  },
  {
    id: "H2",
    product: "home",
    inputs: {
      postcodeArea: "E",
      propertyType: "flat",
      yearBuilt: 1990,
      bedrooms: 2,
      rebuildCostPence: 15_000_000,
      contentsValuePence: 3_000_000,
      hasAlarm: true,
      hasSmokeAlarm: true,
      lockType: "multipoint",
      pastClaims: 0,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["postcode_area:E"],
    // buildings 150 × 0.75 × 0.85 × 1.15 = £109.97; contents 30 × 1.90 × 1.55 × 0.95 (alarm) ×
    // 0.95 (multipoint) × 0.95 (2 bedrooms) = £75.73; + IPT
    expected: { outcome: "quoted", minPence: 18_000, maxPence: 32_000, handPence: 20_798 },
  },
  {
    id: "H3",
    product: "home",
    inputs: {
      postcodeArea: "SY",
      propertyType: "detached",
      yearBuilt: 1890,
      bedrooms: 4,
      rebuildCostPence: 45_000_000,
      contentsValuePence: 8_000_000,
      hasAlarm: false,
      hasSmokeAlarm: true,
      lockType: "standard",
      pastClaims: 0,
      coverLevel: "comprehensive",
    },
    lookupKeys: ["postcode_area:SY"],
    // buildings 450 × 0.75 × 1.05 × 1.25 × 1.25 = £553.71; contents 80 × 1.90 × 0.90 × 1.05 ×
    // 1.06 = £152.26; + IPT
    expected: { outcome: "quoted", minPence: 60_000, maxPence: 100_000, handPence: 79_069 },
  },
  {
    id: "B1",
    product: "business",
    inputs: {
      tradeClass: "electrician",
      postcodeArea: "DE",
      turnoverPence: 6_000_000,
      employees: 0,
      coverLevel: "essential",
      addons: [],
    },
    lookupKeys: ["trade:electrician", "postcode_area:DE"],
    // PL band C £115 × 1.00 (turnover) × 1.00 (band 4), + IPT
    expected: { outcome: "quoted", minPence: 8_000, maxPence: 18_000, handPence: 12_880 },
  },
  {
    id: "B2",
    product: "business",
    inputs: {
      tradeClass: "hairdresser",
      postcodeArea: "NG",
      turnoverPence: 2_500_000,
      employees: 0,
      coverLevel: "essential",
      addons: [],
    },
    lookupKeys: ["trade:hairdresser", "postcode_area:NG"],
    // PL band B £85 × 0.85 × 1.07 = £77.31, + IPT
    expected: { outcome: "quoted", minPence: 7_000, maxPence: 14_000, handPence: 8_658 },
  },
  {
    id: "B3",
    product: "business",
    inputs: {
      tradeClass: "builder",
      postcodeArea: "G",
      turnoverPence: 30_000_000,
      employees: 2,
      coverLevel: "comprehensive",
      addons: ["tools"],
    },
    lookupKeys: ["trade:builder", "postcode_area:G"],
    // (PL £170 × 1.45 × 1.15 + EL 2 × £210) × 1.15 + tools £120 = £929.00, + IPT
    expected: { outcome: "quoted", minPence: 90_000, maxPence: 150_000, handPence: 104_048 },
  },
];
