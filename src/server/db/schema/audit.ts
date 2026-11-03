import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { areaVerb, createdAt } from "./columns";

// Ready for a hash chain (4.2, decision 15); the 4.5 audit() helper writes it. Rows can never be
// updated or deleted (the 0002 trigger). No foreign keys: deleting an account (4.7) keeps its audit
// rows with the user id and nothing else about the person, and the hashes stay valid. Ids and the
// names and values of changed fields only, never emails, addresses or chat text.
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
    // Before/after of the changed fields only
    changes: jsonb(),
    reason: text(),
    requestId: text(),
    // A hash, never the address
    ipHash: text(),
    // sha256(prev_hash ‖ row contents); only the first row has no previous hash
    prevHash: text(),
    hash: text().notNull().unique(),
  },
  (t) => [
    check("audit_log_action_check", areaVerb(t.action)),
    // At most one row starts the chain
    uniqueIndex("audit_log_one_first_row_idx")
      .on(sql`(${t.prevHash} is null)`)
      .where(sql`${t.prevHash} is null`),
    index().on(t.entityType, t.entityId),
    index().on(t.actorUserId),
    index().on(t.action),
    index().on(t.createdAt),
  ],
);
