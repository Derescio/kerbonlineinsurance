// Every audit action, with the entity type it records against. audit() takes the entity type from
// here, so a caller can't pair an action with the wrong one. No imports: the make-admin and
// reset scripts run under plain node and import this file by its .ts path.
export const AUDIT_ACTIONS = {
  "claim.viewed": { entityType: "claim", description: "A staff member opened a claim" },
  "referral.viewed": { entityType: "quote_item", description: "A staff member opened a referral" },
  "staff.added": { entityType: "user", description: "Someone was made staff" },
  "two_factor.disabled": { entityType: "user", description: "Two-factor was turned off" },
  "sessions.revoked_all": { entityType: "user", description: "Signed out everywhere" },
  "two_factor.reset": {
    entityType: "user",
    description: "Two-factor was reset by an admin script",
  },
  "account.deleted": { entityType: "user", description: "An account was deleted by its owner" },
  "account.closure_requested": {
    entityType: "user",
    description: "A customer asked to close their account",
  },
  "account.closure_cancelled": {
    entityType: "user",
    description: "A customer kept their account",
  },
  "account.closure_held": {
    entityType: "user",
    description: "A closure was held back by an open claim",
  },
  "account.closed": { entityType: "user", description: "An account was closed" },
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
