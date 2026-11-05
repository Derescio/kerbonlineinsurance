import { eq } from "drizzle-orm";

import type { Db } from "#/server/db/client";
import { securityEvents, type SecurityEventType, users } from "#/server/db/schema";

import { clientIp, hashIp, summariseUserAgent } from "./request-info";
import { logSafeError } from "./errors";

export interface SecurityEventInput {
  type: SecurityEventType;
  userId?: string | null;
  method?: "password" | "google" | null;
  headers?: Headers;
}

/**
 * Writes one security_events row (4.4). Best-effort: a failed insert is logged with the event type
 * only and never fails the sign-in it describes.
 */
export async function recordSecurityEvent(
  db: Db,
  secret: string,
  { type, userId = null, method = null, headers }: SecurityEventInput,
): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      type,
      userId,
      method,
      ipHash: await hashIp(clientIp(headers), secret),
      userAgentSummary: summariseUserAgent(headers?.get("user-agent")),
    });
  } catch (error) {
    console.error(`[auth] security event ${type} not recorded:`, logSafeError(error));
  }
}

/** The user id for an email, so a failure can be attributed without storing the address. */
export async function userIdForEmail(db: Db, email: unknown): Promise<string | null> {
  if (typeof email !== "string" || email.length === 0) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}
