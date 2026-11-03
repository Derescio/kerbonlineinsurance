import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, oneOf, updatedAt } from "./columns";
import { staffRoles } from "./values";

// The single source of a user's role (4.2, decision 18): no row means a customer. Staff are
// deactivated (6.8), never deleted, so `RESTRICT` from users keeps their history attributed.
export const staffMembers = pgTable(
  "staff_members",
  {
    userId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text().notNull(),
    // What customers see, e.g. "Sam from Kerb claims"
    displayName: text().notNull(),
    // Pseudonymous id, the only identifier the pipeline copies
    staffCode: text().notNull().unique("staff_members_staff_code_unique"),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("staff_members_role_check", oneOf(t.role, staffRoles)),
    check("staff_members_staff_code_check", sql`${t.staffCode} ~ '^H-[0-9]{3}$'`),
    check(
      "staff_members_deactivated_at_check",
      sql`${t.deactivatedAt} is null or ${t.deactivatedAt} > ${t.startedAt}`,
    ),
    index().on(t.role),
    index().on(t.updatedAt),
  ],
);
