import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, lastFour, oneOf, pence, updatedAt } from "./columns";
import { customers } from "./customers";
import { quoteItems, quotes } from "./quotes";
import {
  checkoutSessionStatuses,
  paymentPlans,
  paymentStatuses,
  policyChangeKinds,
  policyChangeSettlements,
  policyChangeStatuses,
  policyStatuses,
  products,
  reasonCodes,
  underwritingOutcomes,
} from "./values";

// Policies are history: RESTRICT from the customer, the quote item and each other (4.2, decision
// 11). Delete account (4.7) removes them explicitly, on purpose.

export const bundles = pgTable(
  "bundles",
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    quoteId: uuid().notNull().unique("bundles_quote_id_unique"),
    createdAt: createdAt(),
  },
  (t) => [
    // The customer's own quote
    foreignKey({
      name: "bundles_quote_fk",
      columns: [t.quoteId, t.customerId],
      foreignColumns: [quotes.id, quotes.customerId],
    }).onDelete("restrict"),
    // Target of policies' composite key
    unique("bundles_id_quote_id_unique").on(t.id, t.quoteId),
    index().on(t.customerId),
  ],
);

export const policies = pgTable(
  "policies",
  {
    id: id(),
    reference: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    // The accepted quote and the item on it this policy was bought from (one policy per item)
    quoteId: uuid().notNull(),
    quoteItemId: uuid().notNull().unique("policies_quote_item_id_unique"),
    bundleId: uuid(),
    // The policy this one renews (retention data)
    renewalOfPolicyId: uuid().unique("policies_renewal_of_policy_id_unique"),
    product: text().notNull(),
    coverLevel: text().notNull(),
    status: text().notNull().default("active"),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    annualPremiumPence: pence(),
    // The total excess is their sum
    compulsoryExcessPence: pence(),
    voluntaryExcessPence: pence().default(0),
    autoRenew: boolean().notNull().default(true),
    termsAcceptedAt: timestamp({ withTimezone: true }).notNull(),
    version: integer().notNull().default(1),
    cancelledAt: timestamp({ withTimezone: true }),
    // Set while `lapsed`: a monthly instalment went unpaid (5.6b, decision 8)
    lapsedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("policies_reference_check", sql`${t.reference} ~ '^KRB-[0-9]{6}$'`),
    check("policies_product_check", oneOf(t.product, products)),
    check("policies_status_check", oneOf(t.status, policyStatuses)),
    check("policies_dates_check", sql`${t.endsOn} > ${t.startsOn}`),
    check(
      "policies_amounts_check",
      sql`${t.annualPremiumPence} > 0 and ${t.compulsoryExcessPence} >= 0 and ${t.voluntaryExcessPence} >= 0`,
    ),
    check("policies_version_check", sql`${t.version} >= 1`),
    check(
      "policies_cancelled_at_check",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    check("policies_lapsed_at_check", sql`${t.lapsedAt} is null or ${t.status} = 'lapsed'`),
    check("policies_renewal_check", sql`${t.renewalOfPolicyId} <> ${t.id}`),
    // Ownership is checked by composite keys (review M4): the quote is the customer's, the item is
    // on that quote and of the same product, the bundle is that quote's, and a renewal renews one
    // of the customer's own policies.
    foreignKey({
      name: "policies_quote_fk",
      columns: [t.quoteId, t.customerId],
      foreignColumns: [quotes.id, quotes.customerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "policies_quote_item_fk",
      columns: [t.quoteItemId, t.quoteId, t.product],
      foreignColumns: [quoteItems.id, quoteItems.quoteId, quoteItems.product],
    }).onDelete("restrict"),
    foreignKey({
      name: "policies_bundle_fk",
      columns: [t.bundleId, t.quoteId],
      foreignColumns: [bundles.id, bundles.quoteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "policies_renewal_fk",
      columns: [t.renewalOfPolicyId, t.customerId],
      foreignColumns: [t.id, t.customerId],
    }).onDelete("restrict"),
    // Target of claims' and reviews' composite keys (decision 7)
    unique("policies_id_customer_id_unique").on(t.id, t.customerId),
    index().on(t.customerId),
    // "My policies, newest first" in one index scan (6.1, from 4.5)
    index().on(t.customerId, t.createdAt),
    index().on(t.quoteId),
    index().on(t.bundleId),
    index().on(t.status),
    index().on(t.createdAt),
    index().on(t.updatedAt),
  ],
);

// One row per charge (decision 19); a monthly plan writes its 11 future instalments as `scheduled`.
// Card brand and last four only. Fake payments until a real provider.
export const payments = pgTable(
  "payments",
  {
    id: id(),
    customerId: uuid().notNull(),
    // The accepted quote, which covers every policy in a bundle
    quoteId: uuid().notNull(),
    plan: text().notNull(),
    instalmentNumber: smallint().notNull(),
    amountPence: pence(),
    status: text().notNull().default("scheduled"),
    cardBrand: text().notNull(),
    cardLast4: text().notNull(),
    dueOn: date().notNull(),
    paidAt: timestamp({ withTimezone: true }),
    // Stripe's ids; null on 5.6's demo rows and on instalments not yet charged
    stripePaymentIntentId: text().unique("payments_stripe_payment_intent_id_unique"),
    stripeInvoiceId: text().unique("payments_stripe_invoice_id_unique"),
    stripeSubscriptionId: text(),
    // When Kerb voided this month's invoice because the cover had lapsed (5.6b, decision 8): the
    // row stays `failed`, but the month had no cover, so it's never owed for a resume
    voidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payments_plan_check", oneOf(t.plan, paymentPlans)),
    check(
      "payments_instalment_number_check",
      sql`${t.instalmentNumber} between 1 and 12 and (${t.plan} = 'monthly' or ${t.instalmentNumber} = 1)`,
    ),
    check("payments_amount_check", sql`${t.amountPence} > 0`),
    check("payments_status_check", oneOf(t.status, paymentStatuses)),
    check("payments_card_last4_check", lastFour(t.cardLast4)),
    check(
      "payments_paid_at_check",
      sql`(${t.status} in ('succeeded', 'refunded')) = (${t.paidAt} is not null)`,
    ),
    foreignKey({
      name: "payments_quote_fk",
      columns: [t.quoteId, t.customerId],
      foreignColumns: [quotes.id, quotes.customerId],
    }).onDelete("restrict"),
    unique("payments_quote_id_instalment_number_unique").on(t.quoteId, t.instalmentNumber),
    index().on(t.customerId),
    index().on(t.status),
    index().on(t.dueOn),
    index().on(t.updatedAt),
    index().on(t.stripeSubscriptionId),
  ],
);

// One row per Stripe Checkout Session (5.6b, decisions 5 to 7): what the customer chose when it was
// made, so fulfilment reruns the purchase with the same answers. One `open` row per quote.
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: id(),
    quoteId: uuid().notNull(),
    customerId: uuid().notNull(),
    stripeSessionId: text().notNull().unique("checkout_sessions_stripe_session_id_unique"),
    plan: text().notNull(),
    startsOn: date().notNull(),
    detailsConfirmedAt: timestamp({ withTimezone: true }).notNull(),
    coverAcknowledgedAt: timestamp({ withTimezone: true }).notNull(),
    // The expected total (annual) or the monthly payment
    amountPence: pence(),
    status: text().notNull().default("open"),
    fulfilledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("checkout_sessions_plan_check", oneOf(t.plan, paymentPlans)),
    check("checkout_sessions_status_check", oneOf(t.status, checkoutSessionStatuses)),
    check("checkout_sessions_amount_check", sql`${t.amountPence} > 0`),
    foreignKey({
      name: "checkout_sessions_quote_fk",
      columns: [t.quoteId, t.customerId],
      foreignColumns: [quotes.id, quotes.customerId],
    }).onDelete("restrict"),
    uniqueIndex("checkout_sessions_one_open_per_quote")
      .on(t.quoteId)
      .where(sql`${t.status} = 'open'`),
    index().on(t.customerId),
  ],
);

// Stripe event ids already handled: the gate that makes a webhook delivered twice act once. Ids
// and types only, never the body; the daily housekeeping deletes rows after 30 days.
export const stripeEvents = pgTable(
  "stripe_events",
  {
    eventId: text().primaryKey(),
    type: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.receivedAt)],
);

// One row per policy change that reached a price (6.3b, decision 8): what was asked, the price
// before and after, how the difference is settled and its Stripe ids. `request` can hold a new
// driver's name, so it never leaves Postgres. One change per policy may wait for payment.
export const policyChanges = pgTable(
  "policy_changes",
  {
    id: id(),
    policyId: uuid().notNull(),
    customerId: uuid().notNull(),
    kind: text().notNull(),
    request: jsonb().notNull(),
    // The policies.version it was priced against, and the one it made once applied
    fromVersion: integer().notNull(),
    toVersion: integer(),
    oldAnnualPence: pence(),
    newAnnualPence: pence(),
    // The car's money for the year (premium less saving, add-ons, IPT and fee), as it stands and
    // with the change, both on the policy's own rating version
    priceBeforePence: pence(),
    priceAfterPence: pence(),
    outcome: text().notNull(),
    reasonCode: text(),
    settlement: text().notNull(),
    // The top-up, the refund, or the change to each remaining instalment (signed)
    amountPence: integer().notNull(),
    status: text().notNull().default("priced"),
    failureReason: text(),
    stripeSessionId: text().unique("policy_changes_stripe_session_id_unique"),
    stripePaymentIntentId: text().unique("policy_changes_stripe_payment_intent_id_unique"),
    stripeRefundId: text().unique("policy_changes_stripe_refund_id_unique"),
    appliedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("policy_changes_kind_check", oneOf(t.kind, policyChangeKinds)),
    check("policy_changes_outcome_check", oneOf(t.outcome, underwritingOutcomes)),
    check("policy_changes_reason_code_check", oneOf(t.reasonCode, reasonCodes)),
    check("policy_changes_settlement_check", oneOf(t.settlement, policyChangeSettlements)),
    check("policy_changes_status_check", oneOf(t.status, policyChangeStatuses)),
    check(
      "policy_changes_applied_check",
      sql`(${t.status} = 'applied') = (${t.toVersion} is not null and ${t.appliedAt} is not null)`,
    ),
    foreignKey({
      name: "policy_changes_policy_fk",
      columns: [t.policyId, t.customerId],
      foreignColumns: [policies.id, policies.customerId],
    }).onDelete("restrict"),
    uniqueIndex("policy_changes_one_open_per_policy")
      .on(t.policyId)
      .where(sql`${t.status} = 'awaiting_payment'`),
    index().on(t.policyId),
    index().on(t.customerId),
    index().on(t.status),
    index().on(t.updatedAt),
  ],
);

// The policy as it stood from each version on (6.3b, decision 9): version 1 as sold, one more per
// applied change. Append-only. `snapshot` is safe to copy; names, dates of birth and the address
// are in `personal`, which never leaves Postgres.
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: id(),
    policyId: uuid()
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    version: integer().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    policyChangeId: uuid().references(() => policyChanges.id, { onDelete: "restrict" }),
    snapshot: jsonb().notNull(),
    personal: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("policy_versions_version_check", sql`${t.version} >= 1`),
    check("policy_versions_change_check", sql`(${t.version} = 1) = (${t.policyChangeId} is null)`),
    unique("policy_versions_policy_id_version_unique").on(t.policyId, t.version),
    index().on(t.policyChangeId),
    index().on(t.createdAt),
  ],
);
