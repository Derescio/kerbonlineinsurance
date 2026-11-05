import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, oneOf, updatedAt } from "./columns";
import { staffRoles as roleValues } from "./values";

// Who is staff (4.2, decision 18): no row means a customer; their roles are in staff_roles (4.5). Staff are
// deactivated (6.8), never deleted, so `RESTRICT` from users keeps their history attributed.
export const staffMembers = pgTable(
  "staff_members",
  {
    userId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
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
    check("staff_members_staff_code_check", sql`${t.staffCode} ~ '^H-[0-9]{3}$'`),
    check(
      "staff_members_deactivated_at_check",
      sql`${t.deactivatedAt} is null or ${t.deactivatedAt} > ${t.startedAt}`,
    ),
    index().on(t.updatedAt),
  ],
);

// The roles a staff member holds (4.5): one row per role, so a person can be both a claims handler
// and an admin. Granted and removed, never edited (append-only trigger in 0007); a removal lands in
// deleted_rows for the pipeline.
export const staffRoles = pgTable(
  "staff_roles",
  {
    userId: text()
      .notNull()
      .references(() => staffMembers.userId, { onDelete: "cascade" }),
    role: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "staff_roles_pkey", columns: [t.userId, t.role] }),
    check("staff_roles_role_check", oneOf(t.role, roleValues)),
    index().on(t.role),
  ],
);
