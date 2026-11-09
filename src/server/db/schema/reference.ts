import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, oneOf, pence, updatedAt } from "./columns";
import { ratingVersions } from "./underwriting";
import { bodyStyles, coverLevels, fuelTypes, lookupKinds, transmissions } from "./values";

// Reference data (4.8, plan/phases/04-data-auth/08-reference-data.md). Written only by the deploy's
// upsert as the owner; kerb_app can read but not change them (0015, call 18). The sources are the
// typed files under src/server/reference/.

// One variant in one model year. Corrected in place and never deleted: a variant dropped from the
// source is marked inactive, so vehicles that point at it still join (call 8).
export const vehicleCatalogue = pgTable(
  "vehicle_catalogue",
  {
    id: id(),
    make: text().notNull(),
    model: text().notNull(),
    year: smallint().notNull(),
    variant: text().notNull(),
    bodyStyle: text().notNull(),
    fuelType: text().notNull(),
    transmission: text().notNull(),
    doors: smallint().notNull(),
    // Null for electric cars
    engineCc: smallint(),
    powerBhp: smallint().notNull(),
    insuranceGroup: smallint().notNull(),
    valuePence: pence(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("vehicle_catalogue_body_style_check", oneOf(t.bodyStyle, bodyStyles)),
    check("vehicle_catalogue_fuel_type_check", oneOf(t.fuelType, fuelTypes)),
    check("vehicle_catalogue_transmission_check", oneOf(t.transmission, transmissions)),
    check("vehicle_catalogue_doors_check", sql`${t.doors} between 2 and 7`),
    check("vehicle_catalogue_insurance_group_check", sql`${t.insuranceGroup} between 1 and 50`),
    check(
      "vehicle_catalogue_amounts_check",
      sql`${t.valuePence} > 0 and ${t.powerBhp} > 0 and (${t.engineCc} is null or ${t.engineCc} > 0)`,
    ),
    unique("vehicle_catalogue_variant_unique").on(t.make, t.model, t.year, t.variant),
    index().on(t.make, t.model, t.year),
    index().on(t.updatedAt),
  ],
);

// The rows of one rating version, never changed once written (call 9); they go with a draft
// version when it's deleted.
const versionId = () =>
  uuid()
    .notNull()
    .references(() => ratingVersions.id, { onDelete: "cascade" });
const identity = () => bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const multiplier = () => numeric({ precision: 8, scale: 4 }).notNull();

// Named numbers: base rates, minimum and maximum premiums, IPT, thresholds (calls 16, 17)
export const ratingParameters = pgTable(
  "rating_parameters",
  {
    id: identity(),
    ratingVersionId: versionId(),
    name: text().notNull(),
    value: numeric({ precision: 14, scale: 4 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("rating_parameters_version_name_unique").on(t.ratingVersionId, t.name)],
);

export const ratingTiers = pgTable(
  "rating_tiers",
  {
    id: identity(),
    ratingVersionId: versionId(),
    coverLevel: text().notNull(),
    multiplier: multiplier(),
    compulsoryExcessPence: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("rating_tiers_cover_level_check", oneOf(t.coverLevel, coverLevels)),
    check(
      "rating_tiers_amounts_check",
      sql`${t.multiplier} > 0 and ${t.compulsoryExcessPence} >= 0`,
    ),
    unique("rating_tiers_version_cover_level_unique").on(t.ratingVersionId, t.coverLevel),
  ],
);

export const ratingAddons = pgTable(
  "rating_addons",
  {
    id: identity(),
    ratingVersionId: versionId(),
    addon: text().notNull(),
    annualPricePence: integer().notNull(),
    // The factors that multiply its price; empty means a flat price
    factors: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Lookup groups that can buy it (e.g. trades_construction); null means everyone
    availableToGroups: text().array(),
    createdAt: createdAt(),
  },
  (t) => [
    check("rating_addons_price_check", sql`${t.annualPricePence} > 0`),
    unique("rating_addons_version_addon_unique").on(t.ratingVersionId, t.addon),
  ],
);

// Band → multiplier. Numeric factors carry their inclusive range; a null range_to is "and above"
// (call 12).
export const ratingFactors = pgTable(
  "rating_factors",
  {
    id: identity(),
    ratingVersionId: versionId(),
    factor: text().notNull(),
    band: text().notNull(),
    rangeFrom: bigint({ mode: "number" }),
    rangeTo: bigint({ mode: "number" }),
    multiplier: multiplier(),
    createdAt: createdAt(),
  },
  (t) => [
    check("rating_factors_multiplier_check", sql`${t.multiplier} > 0`),
    check(
      "rating_factors_range_check",
      sql`${t.rangeTo} is null or ${t.rangeFrom} is null or ${t.rangeTo} >= ${t.rangeFrom}`,
    ),
    unique("rating_factors_version_factor_band_unique").on(t.ratingVersionId, t.factor, t.band),
  ],
);

// Long lists → band: postcode areas, occupations, trades (call 11)
export const ratingLookups = pgTable(
  "rating_lookups",
  {
    id: identity(),
    ratingVersionId: versionId(),
    lookup: text().notNull(),
    // The band factor it feeds, e.g. buildings_postcode_band
    factor: text().notNull(),
    key: text().notNull(),
    label: text().notNull(),
    // Region for postcode areas, trade group for trades
    group: text(),
    band: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("rating_lookups_lookup_check", oneOf(t.lookup, lookupKinds)),
    unique("rating_lookups_version_factor_key_unique").on(t.ratingVersionId, t.factor, t.key),
  ],
);
