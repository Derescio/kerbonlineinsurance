import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { CLOSURE_WINDOW_DAYS } from "#/server/account/constants";

import { users } from "./auth";
import { createdAt, id, updatedAt } from "./columns";

// A request to close an account (4.7). The account closes at `closes_at`, 30 days after the
// request, unless the customer cancels first. One open request per user. RESTRICT, not CASCADE:
// the row outlives its user's deletion attempts so a closed account stays accounted for.
export const accountClosures = pgTable(
  "account_closures",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    cancelledAt: timestamp({ withTimezone: true }),
    // Set while an open claim stops the closure; cleared when the claim ends
    heldSince: timestamp({ withTimezone: true }),
    // Carries a claim reference, so the data contract drops it
    holdReason: text(),
    closedAt: timestamp({ withTimezone: true }),
    // When the insurance records may finally go (closure + RETENTION.insuranceRecordsYears)
    retainUntil: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("account_closures_open_unique")
      .on(t.userId)
      .where(sql`${t.cancelledAt} is null and ${t.closedAt} is null`),
    check(
      "account_closures_one_ending_check",
      sql`${t.cancelledAt} is null or ${t.closedAt} is null`,
    ),
    check(
      "account_closures_window_check",
      sql`${t.closesAt} = ${t.requestedAt} + interval '${sql.raw(String(CLOSURE_WINDOW_DAYS))} days'`,
    ),
    index("account_closures_closes_at_idx")
      .on(t.closesAt)
      .where(sql`${t.cancelledAt} is null and ${t.closedAt} is null`),
    index("account_closures_user_id_idx").on(t.userId),
  ],
);
