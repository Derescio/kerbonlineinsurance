import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { areaVerb, createdAt } from "./columns";

// Ready for a hash chain (4.2, decision 15); the 4.5 audit() helper writes it. Rows can never be
// updated or deleted (the 0002 trigger). No foreign keys to people: deleting an account (4.7) keeps
// its audit rows with the user id and nothing else about the person, and the hashes stay valid.
// Ids and the names of changed fields; values only for fields that aren't personal data, never
// emails, addresses or chat text.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    createdAt: createdAt(),
    // Null means the system
    actorUserId: text(),
    // The role at the time
    actorRole: text(),
    // e.g. claim.status_changed, referral.approved, claim.viewed
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    // Before/after of the changed fields; a personal-data field is recorded by name only
    changes: jsonb(),
    reason: text(),
    requestId: text(),
    // A hash, never the address
    ipHash: text(),
    // The previous row's hash; only the first row has none
    prevHash: text(),
    // sha256(prev_hash ‖ row contents), hex
    hash: text().notNull().unique("audit_log_hash_unique"),
  },
  (t) => [
    check("audit_log_action_check", areaVerb(t.action)),
    check(
      "audit_log_hash_check",
      sql`${t.hash} ~ '^[0-9a-f]{64}$' and (${t.prevHash} is null or ${t.prevHash} ~ '^[0-9a-f]{64}$')`,
    ),
    // One chain, no forks: each row has at most one successor, and only one row (nulls not
    // distinct) starts the chain. A racing insert fails with 23505 instead of forking.
    unique("audit_log_prev_hash_unique").on(t.prevHash).nullsNotDistinct(),
    // Every link points at a row that exists
    foreignKey({
      name: "audit_log_prev_hash_fk",
      columns: [t.prevHash],
      foreignColumns: [t.hash],
    }),
    index().on(t.entityType, t.entityId),
    index().on(t.actorUserId),
    index().on(t.action),
    index().on(t.createdAt),
  ],
);
