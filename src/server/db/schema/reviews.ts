import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, oneOf, updatedAt } from "./columns";
import { policies } from "./policies";
import { reviewStatuses } from "./values";

// One review per policy, by the customer who holds it (4.2, decision 9; the UI is 6.7)
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    policyId: uuid().notNull().unique("reviews_policy_id_unique"),
    customerId: uuid().notNull(),
    rating: smallint().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    status: text().notNull().default("pending"),
    moderationReason: text(),
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("reviews_rating_check", sql`${t.rating} between 1 and 5`),
    check("reviews_status_check", oneOf(t.status, reviewStatuses)),
    check(
      "reviews_published_at_check",
      sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`,
    ),
    foreignKey({
      name: "reviews_policy_fk",
      columns: [t.policyId, t.customerId],
      foreignColumns: [policies.id, policies.customerId],
    }).onDelete("cascade"),
    index().on(t.customerId),
    index().on(t.status),
    index().on(t.createdAt),
    index().on(t.updatedAt),
  ],
);
