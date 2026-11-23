import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { mobileSchema } from "#/features/account/settings-model";
import { audit } from "#/server/audit/audit";
import { customers, securityEvents, users } from "#/server/db/schema";
import type { SecurityEventType } from "#/server/db/schema/values";

import { defineRead, defineWrite, rejected } from "./define";

// Account settings (6.3): what Personal details and Recent activity show, and the mobile save.

export interface PersonalDetails {
  /** The login's name and email; the customer's own details once they've saved a quote */
  name: string;
  email: string;
  customer: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string | null;
    addressLine1: string;
    addressLine2: string | null;
    town: string;
    postcode: string;
  } | null;
}

export const getMyPersonalDetails = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<PersonalDetails> => {
    const user = await db.query.users.findFirst({
      columns: { name: true, email: true },
      where: eq(users.id, actor.userId),
    });
    const customer = actor.customerId
      ? await db.query.customers.findFirst({
          columns: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            phone: true,
            addressLine1: true,
            addressLine2: true,
            town: true,
            postcode: true,
          },
          where: eq(customers.id, actor.customerId),
        })
      : undefined;
    return { name: user?.name ?? "", email: user?.email ?? "", customer: customer ?? null };
  },
);

export interface RecentActivity {
  type: SecurityEventType;
  method: string | null;
  /** "Chrome on Windows"; null when it wasn't known */
  device: string | null;
  /** ISO time */
  at: string;
}

/** The 10 newest security events (decision 7). Never the IP hash */
export const getMyRecentActivity = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<RecentActivity[]> => {
    const rows = await db
      .select({
        type: securityEvents.type,
        method: securityEvents.method,
        device: securityEvents.userAgentSummary,
        at: securityEvents.createdAt,
      })
      .from(securityEvents)
      .where(eq(securityEvents.userId, actor.userId))
      // ids are uuidv7, so they break a same-millisecond tie in the order the rows were written
      .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
      .limit(10);
    return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
  },
);

/**
 * Adds, changes or clears the customer's mobile (decision 4). The audit row and the reply say only
 * whether a number is set, so neither the hash-chained log nor the idempotency row (which keeps the
 * reply for replays) holds it. One key per Save: a retry is one change.
 */
export const updateMyPhone = defineWrite(
  z.object({ phone: mobileSchema }),
  { idempotent: { action: "account.update_phone" } },
  async (actor, { phone }, tx) => {
    if (!actor.customerId) return rejected("Save a quote first to add a mobile number.");
    await tx
      .update(customers)
      .set({ phone, updatedAt: new Date() })
      .where(eq(customers.id, actor.customerId));
    await audit(tx, {
      actor,
      action: "customer.phone_changed",
      entityId: actor.customerId,
      changes: { phone: { set: phone !== null } },
    });
    return { set: phone !== null };
  },
);
