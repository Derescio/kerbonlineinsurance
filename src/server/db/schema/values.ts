// The closed sets Postgres checks (`CHECK (column in (...))`). Zod schemas and UI code import these
// rather than repeating the strings.

export const products = ["car", "home", "business"] as const;
export type Product = (typeof products)[number];

export const staffRoles = ["claims_handler", "admin"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const quoteStatuses = [
  "draft",
  "priced",
  "referred",
  "declined",
  "accepted",
  "expired",
] as const;
export const underwritingOutcomes = ["quoted", "referred", "declined"] as const;
// Why an item was referred or declined (5.4, spec decision 8). Rule types are code; the numbers that
// trigger them are rating-version data.
export const reasonCodes = [
  "outside_cover_area",
  "vehicle_value_too_high",
  "young_driver_high_group",
  "high_insurance_group",
  "high_vehicle_value",
  "past_claims",
  "new_licence_high_group",
  "driver_age",
  "rebuild_cost_too_high",
  "high_rebuild_cost",
  "high_contents_value",
  "old_property",
  "high_turnover",
  "many_employees",
  "high_risk_employees",
  "premium_above_max",
] as const;
export type ReasonCode = (typeof reasonCodes)[number];
export const ratingVersionStatuses = ["draft", "active", "retired"] as const;
export const paymentPlans = ["annual", "monthly"] as const;
export const paymentStatuses = ["scheduled", "succeeded", "failed", "refunded"] as const;

export const fuelTypes = ["petrol", "diesel", "hybrid", "electric"] as const;
export const vehicleUsages = ["social", "commuting", "business"] as const;
export const overnightLocations = ["garage", "driveway", "street"] as const;
export const propertyTypes = ["detached", "semi", "terraced", "flat", "bungalow"] as const;
export const lockTypes = ["standard", "five_lever", "multipoint"] as const;

// Reference data (4.8)
export const bodyStyles = [
  "hatchback",
  "saloon",
  "estate",
  "suv",
  "coupe",
  "convertible",
  "mpv",
] as const;
export type BodyStyle = (typeof bodyStyles)[number];
export const transmissions = ["manual", "automatic"] as const;
export type Transmission = (typeof transmissions)[number];
export type FuelType = (typeof fuelTypes)[number];
export const coverLevels = ["essential", "comprehensive", "plus"] as const;
export type CoverLevel = (typeof coverLevels)[number];
export const lookupKinds = ["postcode_area", "occupation", "trade"] as const;
export type LookupKind = (typeof lookupKinds)[number];

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

// Uploads (4.10). Kerbie's `kerbie_image` arrives with the chat tables in Phase 7.
export const fileKinds = ["claim_photo", "claim_document", "review_photo"] as const;
export type FileKind = (typeof fileKinds)[number];
export const fileStatuses = ["pending", "ready", "rejected", "deleted"] as const;
export type FileStatus = (typeof fileStatuses)[number];
// What is stored: photos re-encoded in the browser (JPEG where the browser can't encode WebP), PDFs as uploaded
export const fileMimes = ["image/webp", "image/jpeg", "application/pdf"] as const;
export type FileMime = (typeof fileMimes)[number];
