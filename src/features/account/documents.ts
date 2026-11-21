import { isCovered } from "./overview-model";

// A policy's documents (6.2, decision 5), shared by the pages that list them and the route that
// makes them, so a page never offers a document the route would refuse.

export const policyDocumentKinds = ["certificate", "schedule"] as const;
export type PolicyDocumentKind = (typeof policyDocumentKinds)[number];

export const documentTitles: Record<PolicyDocumentKind, string> = {
  certificate: "Certificate of motor insurance",
  schedule: "Policy schedule",
};

export function isPolicyDocumentKind(value: string): value is PolicyDocumentKind {
  return (policyDocumentKinds as readonly string[]).includes(value);
}

/**
 * Every policy has its schedule. A car has a certificate only while its cover is in force or
 * starts later: one for a lapsed, cancelled or ended policy would claim cover that isn't there.
 */
export function policyDocuments(
  policy: { product: string; status: string; endsOn: string },
  today: string,
): PolicyDocumentKind[] {
  return policy.product === "car" && isCovered(policy, today)
    ? ["certificate", "schedule"]
    : ["schedule"];
}

export const documentHref = (reference: string, kind: PolicyDocumentKind) =>
  `/api/policies/${reference}/documents/${kind}`;

export const documentFilename = (reference: string, kind: PolicyDocumentKind) =>
  `Kerb-${reference}-${kind}.pdf`;
