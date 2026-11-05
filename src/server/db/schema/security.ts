import { sql } from "drizzle-orm";
import { check, index, pgTable, text } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, id, oneOf } from "./columns";

// Sign-ins, failures and resets (4.4), shown later as "Recent activity" in Settings (6.3). Not
// hash-chained like audit_log, so bot traffic can't flood the chain; append-only (the 0004
// trigger), and deleted with the account (4.7). Never an email, an IP or a raw user agent.
export const SECURITY_EVENT_TYPES = [
  "sign_up",
  "sign_in",
  "sign_in_failed",
  "rate_limited",
  "sign_out",
  "password_reset_requested",
  "password_reset",
  "email_verified",
  "google_linked",
  "google_link_refused",
  "password_removed_on_link",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SECURITY_EVENT_METHODS = ["password", "google"] as const;

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
