import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, id, oneOf } from "./columns";
import { SECURITY_EVENT_TYPES, type SecurityEventType } from "./values";

// Sign-ins, failures and resets (4.4), shown later as "Recent activity" in Settings (6.3). Not
// hash-chained like audit_log, so bot traffic can't flood the chain; append-only (the 0004
// trigger). Deleted on an immediate account delete (4.7); kept with a closed account. Never an
// email, an IP or a raw user agent.
// The types live in values.ts so Recent activity (6.3) can label every one
export { SECURITY_EVENT_TYPES, type SecurityEventType } from "./values";

export const SECURITY_EVENT_METHODS = ["password", "google", "totp", "backup_code"] as const;

export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    // Null when the request names no known user (a failed sign-in for an unknown address)
    userId: text().references(() => users.id, { onDelete: "cascade" }),
    type: text().$type<SecurityEventType>().notNull(),
    method: text().$type<(typeof SECURITY_EVENT_METHODS)[number]>(),
    // HMAC-SHA256 of the IP, keyed with BETTER_AUTH_SECRET (src/server/auth/request-info.ts)
    ipHash: text(),
    // "Chrome on Windows", never the raw string
    userAgentSummary: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check("security_events_type_check", oneOf(t.type, SECURITY_EVENT_TYPES)),
    check("security_events_method_check", oneOf(t.method, SECURITY_EVENT_METHODS)),
    check(
      "security_events_ip_hash_check",
      sql`${t.ipHash} is null or ${t.ipHash} ~ '^[0-9a-f]{64}$'`,
    ),
    index().on(t.userId, t.createdAt),
    index().on(t.type, t.createdAt),
  ],
);
