import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, lastFour, oneOf, pence, updatedAt } from "./columns";
import { customers } from "./customers";
import { quoteItems, quotes } from "./quotes";
import { paymentPlans, paymentStatuses, policyStatuses, products } from "./values";

// Policies are history: RESTRICT from the customer, the quote item and each other (4.2, decision
// 11). Delete account (4.7) removes them explicitly, on purpose.

export const bundles = pgTable(
  "bundles",
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    quoteId: uuid()
      .notNull()
      .unique("bundles_quote_id_unique")
      .references(() => quotes.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.customerId)],
);

export const policies = pgTable(
  "policies",
  {
    id: id(),
    reference: text().notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    // One policy per quoted product
    quoteItemId: uuid().notNull().unique("policies_quote_item_id_unique"),
    bundleId: uuid().references(() => bundles.id, { onDelete: "restrict" }),
    // The policy this one renews (retention data)
    renewalOfPolicyId: uuid()
      .unique("policies_renewal_of_policy_id_unique")
      .references((): AnyPgColumn => policies.id, { onDelete: "restrict" }),
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
    // The quote item it was bought from, of the same product
    foreignKey({
      name: "policies_quote_item_fk",
      columns: [t.quoteItemId, t.product],
      foreignColumns: [quoteItems.id, quoteItems.product],
    }).onDelete("restrict"),
    // Target of claims' and reviews' composite keys (decision 7)
    unique("policies_id_customer_id_unique").on(t.id, t.customerId),
    index().on(t.customerId),
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
  ],
);
