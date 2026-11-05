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

// The extra columns on a claim's detail, shared by the customer and staff reads.
export const claimDetailColumns = {
  ...claimSummaryColumns,
  incidentLocation: true,
  description: true,
  otherVehicleInvolved: true,
  rearEnded: true,
  injuries: true,
  policeAttended: true,
  policeReference: true,
  claimedAmountPence: true,
  version: true,
} as const;
