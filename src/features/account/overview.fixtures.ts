import type { PolicyListItem } from "#/server/data/policies";

// Test data for the Overview (6.1): frame 01's car, Maya Patel's Volkswagen Golf

export function policy(over: Partial<PolicyListItem> = {}): PolicyListItem {
  return {
    id: "p1",
    reference: "KRB-482913",
    product: "car",
    coverLevel: "comprehensive",
    status: "active",
    startsOn: "2026-03-14",
    endsOn: "2027-03-13",
    monthly: true,
    bundle: null,
    earnedBy: null,
    label: { kind: "car", plate: "KR24 BXL", make: "Volkswagen", model: "Golf" },
    annualPremiumPence: 53_640,
    boughtOn: "2026-03-14",
    ...over,
  };
}
