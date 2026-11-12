import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, oneOf, pence, postcodeDistrictSql, updatedAt } from "./columns";
import { customers } from "./customers";
import { ratingVersions } from "./underwriting";
import { paymentPlans, products, quoteStatuses, reasonCodes, underwritingOutcomes } from "./values";

// A quote always belongs to a customer (4.2, decision 5): a guest's quote stays in the browser until
// the sign-in gate (5.6). Its totals reconcile in Postgres (decision 14); the UI never recomputes.
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    reference: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text().notNull().default("draft"),
    postcode: text().notNull(),
    postcodeDistrict: text().generatedAlwaysAs(postcodeDistrictSql),
    // The selected options plus selected add-ons
    subtotalPence: pence().default(0),
    bundleDiscountPence: pence().default(0),
    feesPence: pence().default(0),
    iptPence: pence().default(0),
    totalPence: pence().default(0),
    paymentPlan: text(),
    // "I confirm these details are correct", "I understand my cover"
    detailsConfirmedAt: timestamp({ withTimezone: true }),
    coverAcknowledgedAt: timestamp({ withTimezone: true }),
    validUntil: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("quotes_reference_check", sql`${t.reference} ~ '^KRB-Q-[0-9]{5}$'`),
    check("quotes_status_check", oneOf(t.status, quoteStatuses)),
    check("quotes_payment_plan_check", oneOf(t.paymentPlan, paymentPlans)),
    check(
      "quotes_amounts_check",
      sql`${t.subtotalPence} >= 0 and ${t.bundleDiscountPence} >= 0 and ${t.feesPence} >= 0 and ${t.iptPence} >= 0 and ${t.totalPence} >= 0`,
    ),
    // Accepting means a payment plan is chosen and both boxes are ticked
    check(
      "quotes_accepted_check",
      sql`${t.status} <> 'accepted' or (${t.paymentPlan} is not null and ${t.detailsConfirmedAt} is not null and ${t.coverAcknowledgedAt} is not null)`,
    ),
    check("quotes_bundle_discount_check", sql`${t.bundleDiscountPence} <= ${t.subtotalPence}`),
    check(
      "quotes_total_check",
      sql`${t.totalPence} = ${t.subtotalPence} - ${t.bundleDiscountPence} + ${t.feesPence} + ${t.iptPence}`,
    ),
    // Target of payments' composite key
    unique("quotes_id_customer_id_unique").on(t.id, t.customerId),
    index().on(t.customerId),
    index().on(t.status),
    index().on(t.createdAt),
    index().on(t.updatedAt),
  ],
);

// One item per product on a quote (car + home = a bundle): the priced snapshot a policy is bought
// from, with its underwriting outcome (decision 12) and the rating version that priced it.
export const quoteItems = pgTable(
  "quote_items",
  {
    id: id(),
    quoteId: uuid()
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    product: text().notNull(),
    ratingVersionId: uuid().notNull(),
    outcome: text().notNull(),
    reasonCode: text(),
    selectedOptionId: uuid(),
    voluntaryExcessPence: pence().default(0),
    startDate: date().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("quote_items_product_check", oneOf(t.product, products)),
    check("quote_items_outcome_check", oneOf(t.outcome, underwritingOutcomes)),
    check(
      "quote_items_reason_code_check",
      sql`${t.outcome} = 'quoted' or ${t.reasonCode} is not null`,
    ),
    check("quote_items_reason_code_values_check", oneOf(t.reasonCode, reasonCodes)),
    check("quote_items_voluntary_excess_check", sql`${t.voluntaryExcessPence} >= 0`),
    // Rated by a version of the same product
    foreignKey({
      name: "quote_items_rating_version_fk",
      columns: [t.ratingVersionId, t.product],
      foreignColumns: [ratingVersions.id, ratingVersions.product],
    }).onDelete("restrict"),
    // The selected tier must be one of this item's own options
    foreignKey({
      name: "quote_items_selected_option_fk",
      columns: [t.selectedOptionId, t.id],
      foreignColumns: [quoteItemOptions.id, quoteItemOptions.quoteItemId],
    }),
    unique("quote_items_quote_id_product_unique").on(t.quoteId, t.product),
    // Target of the product detail tables' composite keys (decision 6)
    unique().on(t.id, t.product),
    // Target of policies' composite key: the item, its quote and its product
    unique("quote_items_id_quote_id_product_unique").on(t.id, t.quoteId, t.product),
    index().on(t.ratingVersionId),
    index().on(t.selectedOptionId),
    index().on(t.outcome),
    index().on(t.updatedAt),
  ],
);

// Every cover tier offered (Essential / Comprehensive / Plus), each priced, chosen or not (decision 19)
export const quoteItemOptions = pgTable(
  "quote_item_options",
  {
    id: id(),
    quoteItemId: uuid()
      .notNull()
      // Annotated: quote_items references this table back (its selected option)
      .references((): AnyPgColumn => quoteItems.id, { onDelete: "cascade" }),
    // Values checked by Zod per product
    coverLevel: text().notNull(),
    // The tier's own factor
    coverMultiplier: numeric({ precision: 8, scale: 4 }).notNull(),
    compulsoryExcessPence: pence(),
    annualPremiumPence: pence(),
    monthlyPremiumPence: pence(),
    createdAt: createdAt(),
  },
  (t) => [
    check("quote_item_options_cover_multiplier_check", sql`${t.coverMultiplier} > 0`),
    check("quote_item_options_compulsory_excess_check", sql`${t.compulsoryExcessPence} >= 0`),
    check(
      "quote_item_options_premium_check",
      sql`${t.annualPremiumPence} > 0 and ${t.monthlyPremiumPence} > 0`,
    ),
    unique("quote_item_options_quote_item_id_cover_level_unique").on(t.quoteItemId, t.coverLevel),
    unique("quote_item_options_id_quote_item_id_unique").on(t.id, t.quoteItemId),
  ],
);

// Add-ons (UK 24/7 breakdown, motor legal), offered and selected, each priced (decision 19)
export const quoteItemAddons = pgTable(
  "quote_item_addons",
  {
    id: id(),
    quoteItemId: uuid()
      .notNull()
      .references(() => quoteItems.id, { onDelete: "cascade" }),
    addon: text().notNull(),
    annualPricePence: pence(),
    monthlyPricePence: pence(),
    selected: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "quote_item_addons_price_check",
      sql`${t.annualPricePence} > 0 and ${t.monthlyPricePence} > 0`,
    ),
    unique("quote_item_addons_quote_item_id_addon_unique").on(t.quoteItemId, t.addon),
    index().on(t.updatedAt),
  ],
);

// The price breakdown as rows (decision 16): the factors shared by every tier. The summary (5.5)
// is built from these, so it's stored once.
export const quoteItemFactors = pgTable(
  "quote_item_factors",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    quoteItemId: uuid()
      .notNull()
      .references(() => quoteItems.id, { onDelete: "cascade" }),
    // e.g. insurance_group, driver_age, occupation, postcode_band
    factor: text().notNull(),
    // The band or value used
    inputValue: text().notNull(),
    multiplier: numeric({ precision: 8, scale: 4 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("quote_item_factors_multiplier_check", sql`${t.multiplier} > 0`),
    unique("quote_item_factors_quote_item_id_factor_unique").on(t.quoteItemId, t.factor),
  ],
);
