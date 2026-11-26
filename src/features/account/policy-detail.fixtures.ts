import type { PolicyDetail } from "#/server/data/policies";

// Test data for policy detail (6.2): frame 183:3507's car, Maya Patel's Volkswagen Golf, bought
// with her home and paid monthly

export function policyDetail(over: Partial<PolicyDetail> = {}): PolicyDetail {
  return {
    id: "p1",
    reference: "KRB-818784",
    product: "car",
    coverLevel: "comprehensive",
    status: "active",
    startsOn: "2026-03-14",
    endsOn: "2027-03-13",
    annualPremiumPence: 49_100,
    compulsoryExcessPence: 10_000,
    voluntaryExcessPence: 15_000,
    autoRenew: true,
    boughtOn: "2026-03-14",
    cancelledOn: null,
    policyholder: {
      firstName: "Maya",
      lastName: "Patel",
      addressLine1: "11 Rosebery Gardens",
      addressLine2: null,
      town: "London",
      postcode: "N8 8SH",
    },
    car: {
      catalogueVariantId: "0190f3a2-6c1e-7b1a-9d2e-4f5a6b7c8d9e",
      make: "Volkswagen",
      model: "Golf",
      variant: "1.5 TSI Life",
      year: 2021,
      registration: "KR24 BXL",
      valuePence: 1_850_000,
      usage: "commuting",
    },
    drivers: [
      {
        id: "d-maya",
        firstName: "Maya",
        lastName: "Patel",
        isMain: true,
        licenceYears: 9,
        relationship: null,
      },
      {
        id: "d-dev",
        firstName: "Dev",
        lastName: "Patel",
        isMain: false,
        licenceYears: 3,
        relationship: "spouse",
      },
    ],
    home: null,
    coverPremiumPence: 48_900,
    addons: [{ addon: "breakdown", annualPricePence: 4_500 }],
    saving: { kind: "bundle", pence: 4_300 },
    bundled: true,
    plan: { kind: "monthly", instalmentPence: 4_470 },
    quote: { reference: "KRB-Q-71234", totalPence: 98_760 },
    claims: [],
    changes: { eligible: false, latest: null },
    ...over,
  };
}

export const homeDetail = (over: Partial<PolicyDetail> = {}) =>
  policyDetail({
    id: "p2",
    reference: "KRB-552019",
    product: "home",
    coverLevel: "plus",
    car: null,
    drivers: [],
    home: {
      addressLine1: "11 Rosebery Gardens",
      addressLine2: null,
      town: "London",
      postcode: "N8 8SH",
      propertyType: "terraced",
      yearBuilt: 1905,
      bedrooms: 3,
      rebuildCostPence: 42_000_000,
      contentsValuePence: 5_000_000,
      valuablesPence: 800_000,
      lockType: "five_lever",
      windowLocks: "all_accessible",
      alarmType: "installed_unmonitored",
      hasSmokeAlarm: true,
    },
    bundled: false,
    saving: null,
    plan: { kind: "annual" },
    annualPremiumPence: 54_780,
    ...over,
  });
