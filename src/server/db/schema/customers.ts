import { boolean, date, index, pgTable, text } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, id, postcodeDistrictSql, updatedAt } from "./columns";

// The person who buys cover (4.2, decision 4). `users` is the login; staff have no customer row.
// Created at the first saved quote (5.6), so its fields can be NOT NULL.
export const customers = pgTable(
  "customers",
  {
    id: id(),
    userId: text()
      .notNull()
      .unique("customers_user_id_unique")
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text().notNull(),
    lastName: text().notNull(),
    dateOfBirth: date().notNull(),
    phone: text(),
    addressLine1: text().notNull(),
    addressLine2: text(),
    town: text().notNull(),
    postcode: text().notNull(),
    postcodeDistrict: text().generatedAlwaysAs(postcodeDistrictSql),
    paperless: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.updatedAt)],
);
