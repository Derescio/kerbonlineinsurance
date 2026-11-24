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
export const checkoutSessionStatuses = ["open", "completed", "expired", "refunded"] as const;

export const fuelTypes = ["petrol", "diesel", "hybrid", "electric"] as const;
export const vehicleUsages = ["social", "commuting", "business"] as const;
export const overnightLocations = ["garage", "driveway", "street"] as const;
export const propertyTypes = ["detached", "semi", "terraced", "flat", "bungalow"] as const;
export const lockTypes = ["standard", "five_lever", "multipoint"] as const;
// A home's answers that aren't rated, and its past claims (5.7, decision 10)
export const windowLockTypes = ["all_accessible", "some", "none"] as const;
export const alarmTypes = ["none", "installed_unmonitored", "monitored"] as const;
export const homeClaimTypes = [
  "escape_of_water",
  "theft",
  "accidental_damage",
  "storm_flood",
  "fire",
  "subsidence",
  "other",
] as const;
export const priorClaimStatuses = ["settled", "open", "withdrawn"] as const;
// Car's answers kept from 5.7c (decisions 1 and 2): a car incident's type and fault, and each
// driver's licence, employment status and relationship to the policyholder
export const carClaimTypes = [
  "collision",
  "theft",
  "fire",
  "vandalism",
  "windscreen",
  "other",
] as const;
export const faultTypes = ["at_fault", "not_at_fault", "undecided"] as const;
export const licenceTypes = ["full_uk", "full_eu"] as const;
export const employmentStatuses = [
  "employed",
  "self_employed",
  "retired",
  "unemployed",
  "student",
  "homemaker",
] as const;
export type EmploymentStatus = (typeof employmentStatuses)[number];
export const relationshipTypes = [
  "spouse",
  "partner",
  "parent",
  "child",
  "sibling",
  "other_relative",
  "friend",
] as const;

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
// Policy changes (6.3b, decision 8)
export const policyChangeKinds = ["address", "driver_added", "driver_removed", "cover"] as const;
export type PolicyChangeKind = (typeof policyChangeKinds)[number];
export const policyChangeStatuses = [
  "priced",
  "awaiting_payment",
  "applied",
  "failed",
  "abandoned",
  "refused",
] as const;
export type PolicyChangeStatus = (typeof policyChangeStatuses)[number];
export const policyChangeSettlements = ["charge", "refund", "instalments", "none"] as const;
export type PolicyChangeSettlement = (typeof policyChangeSettlements)[number];

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

// security_events.type (4.4, 4.6)
export const SECURITY_EVENT_TYPES = [
  "sign_up",
  "sign_in",
  "sign_in_failed",
  // A correct password on an email that isn't confirmed yet (4.4b)
  "sign_in_unverified",
  "rate_limited",
  "sign_out",
  "password_reset_requested",
  "password_reset",
  "email_verified",
  "google_linked",
  "google_link_refused",
  "password_removed_on_link",
  // Two-factor and sessions (4.6)
  "two_factor_enabled",
  "two_factor_disabled",
  "backup_codes_regenerated",
  "two_factor_passed",
  "two_factor_failed",
  "signed_out_everywhere",
  "sessions_revoked_on_password_change",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
