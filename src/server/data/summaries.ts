// Column picks shared by the customer reads. Not a read, so it stays out of index.ts.
export const claimSummaryColumns = {
  id: true,
  reference: true,
  policyId: true,
  status: true,
  incidentType: true,
  incidentAt: true,
  submittedAt: true,
  createdAt: true,
} as const;
