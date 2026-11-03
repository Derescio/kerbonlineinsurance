// The closed sets Postgres checks (`CHECK (column in (...))`). Zod schemas and UI code import these
// rather than repeating the strings.

export const products = ["car", "home", "business"] as const;
export type Product = (typeof products)[number];

export const staffRoles = ["claims_handler", "admin"] as const;

export const quoteStatuses = [
  "draft",
  "priced",
  "referred",
  "declined",
  "accepted",
  "expired",
] as const;
export const underwritingOutcomes = ["quoted", "referred", "declined"] as const;
export const ratingVersionStatuses = ["draft", "active", "retired"] as const;
export const paymentPlans = ["annual", "monthly"] as const;
export const paymentStatuses = ["scheduled", "succeeded", "failed", "refunded"] as const;

export const fuelTypes = ["petrol", "diesel", "hybrid", "electric"] as const;
export const vehicleUsages = ["social", "commuting", "business"] as const;
export const overnightLocations = ["garage", "driveway", "street"] as const;
export const propertyTypes = ["detached", "semi", "terraced", "flat", "bungalow"] as const;
export const lockTypes = ["standard", "five_lever", "multipoint"] as const;

export const policyStatuses = ["active", "cancelled", "lapsed"] as const;

export const claimStatuses = [
  "draft",
  "received",
  "assessing",
  "approved",
  "declined",
  "settled",
] as const;
export const incidentTypes = ["collision", "theft", "glass", "other"] as const;
export const claimEventTypes = [
  "submitted",
  "status_changed",
  "details_checked",
  "note",
  "file_added",
  "settlement_scheduled",
  "settlement_paid",
] as const;
export const claimEventVisibilities = ["customer", "internal"] as const;
export const messageSenderKinds = ["customer", "staff"] as const;
export const settlementStatuses = ["scheduled", "paid"] as const;

export const reviewStatuses = ["pending", "published", "rejected"] as const;

export const jobStatuses = ["queued", "running", "done", "failed", "dead"] as const;
