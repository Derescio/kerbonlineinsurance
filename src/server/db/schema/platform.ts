import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, oneOf, updatedAt } from "./columns";
import { jobStatuses } from "./values";

// Operational tables (plan/engineering.md sections 8, 10 and 11); their code comes in 4.5 and 4.11.
// The pipeline doesn't copy them.

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text().notNull(),
    requestHash: text().notNull(),
    // Set in the same transaction as the write; never committed null
    response: jsonb(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index().on(t.expiresAt)],
);

// The app's sliding-window counter; Better Auth's limiter has its own table (auth_rate_limits)
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    check("rate_limits_count_check", sql`${t.count} >= 0`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    status: text().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    idempotencyKey: text().notNull().unique("jobs_idempotency_key_unique"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("jobs_status_check", oneOf(t.status, jobStatuses)),
    check("jobs_attempts_check", sql`${t.attempts} >= 0`),
    // The runner's lookup
    index().on(t.status, t.runAfter),
    index().on(t.createdAt),
  ],
);

// Postcodes postcodes.io has confirmed exist (5.2, call 15), so each is looked up once. Only found
// postcodes are stored: one added later is never stuck as "not found". kerb_app may read and add
// rows but not change or remove them (0019). No time is kept: with one, a row could be matched to
// the visitor's district-only quote.started event (5.1, call 11).
export const postcodeAreas = pgTable("postcode_areas", {
  // Normalised: "E8 3RL"
  postcode: text().primaryKey(),
  outcode: text().notNull(),
  adminDistrict: text(),
  region: text(),
  country: text().notNull(),
});
