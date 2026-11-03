import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { areaVerb, createdAt, id, updatedAt } from "./columns";

// Behind the header bell, for every screen (4.2, decision 19). The 4.11 jobs send the email and SMS.
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // e.g. claim.updated, referral.decided, payment.failed, policy.renewal_due
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    linkPath: text(),
    readAt: timestamp({ withTimezone: true }),
    emailSentAt: timestamp({ withTimezone: true }),
    smsSentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("notifications_type_check", areaVerb(t.type)),
    // An in-app path only: not `https://…`, nor `//host` or `/\host` (browsers read both as
    // another site). `\\\\` here is `\\` in SQL: one literal backslash in the bracket expression.
    check(
      "notifications_link_path_check",
      sql`${t.linkPath} ~ '^/' and ${t.linkPath} !~ '^/[/\\\\]'`,
    ),
    index().on(t.userId, t.readAt),
    index().on(t.updatedAt),
  ],
);
