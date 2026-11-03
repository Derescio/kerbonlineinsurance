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
    // Null while the request is in flight
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
