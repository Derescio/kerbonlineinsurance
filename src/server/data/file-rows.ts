import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { getDb, type Db } from "#/server/db/client";
import { claims, files, reviews } from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";
import type { FileStatus } from "#/server/db/schema/values";

// The upload row helpers behind the account hooks (4.7, filled in by 4.10) and the daily cleanup.
// Plain functions, not defineRead: their callers already know who is asking, so the permission
// suite skips this module. Rows are never deleted: `deleted` says the file is gone for the
// customer, and `purged_at` says its objects have left R2.

/** How long an upload may stay unconfirmed before the cleanup takes it */
export const PENDING_HOURS = 24;

/** The app's database, for the cleanup's entry points (the cron route can't reach db/client) */
export function uploadsDb(): Db {
  return getDb();
}

/**
 * The immediate account delete (4.7 call 17): every file of the user's whose objects are still in
 * R2 becomes `deleted`, inside the delete's transaction. Returns their object keys for the caller
 * to delete after the commit, so a rollback never leaves rows pointing at missing objects.
 */
export async function deleteUserFiles(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .update(files)
    .set({ status: "deleted" })
    .where(and(eq(files.ownerUserId, userId), isNull(files.purgedAt)))
    .returning({ objectKey: files.objectKey, thumbKey: files.thumbKey });
  return rows.flatMap((row) => (row.thumbKey ? [row.objectKey, row.thumbKey] : [row.objectKey]));
}

/**
 * Closing an account (4.10 call 10): the files on the customer's draft claims and on their reviews
 * become `deleted`, before closeAccountRows deletes those drafts and reviews. Submitted claims'
 * evidence stays. The next daily cleanup deletes the objects.
 */
export async function markClosureFiles(tx: Tx, customerId: string): Promise<number> {
  const draftClaims = tx
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.customerId, customerId), eq(claims.status, "draft")));
  const customerReviews = tx
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.customerId, customerId));
  const rows = await tx
    .update(files)
    .set({ status: "deleted" })
    .where(
      and(
        ne(files.status, "deleted"),
        or(inArray(files.claimId, draftClaims), inArray(files.reviewId, customerReviews)),
      ),
    )
    .returning({ id: files.id });
  return rows.length;
}

export interface PurgeCandidate {
  id: string;
  status: FileStatus;
  objectKey: string;
  thumbKey: string | null;
}

/** Files whose objects should leave R2: stale uploads, and rejected or deleted files not yet purged */
export async function filesToPurge(db: Db, now: Date, max: number): Promise<PurgeCandidate[]> {
  const staleBefore = new Date(now.getTime() - PENDING_HOURS * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: files.id,
      status: files.status,
      objectKey: files.objectKey,
      thumbKey: files.thumbKey,
    })
    .from(files)
    .where(
      and(
        isNull(files.purgedAt),
        or(
          and(eq(files.status, "pending"), lt(files.createdAt, staleBefore)),
          inArray(files.status, ["rejected", "deleted"]),
        ),
      ),
    )
    .orderBy(asc(files.createdAt))
    .limit(max);
  return rows.map((row) => ({ ...row, status: row.status as FileStatus }));
}

/** Records that these files' objects are gone; a stale upload becomes `deleted` */
export async function markPurged(
  db: Db | Tx,
  which: { ids?: string[]; objectKeys?: string[] },
): Promise<void> {
  const ids = which.ids ?? [];
  const keys = which.objectKeys ?? [];
  if (ids.length === 0 && keys.length === 0) return;
  await db
    .update(files)
    .set({
      purgedAt: sql`now()`,
      status: sql`case when ${files.status} = 'pending' then 'deleted' else ${files.status} end`,
    })
    .where(
      and(
        isNull(files.purgedAt),
        or(
          ids.length > 0 ? inArray(files.id, ids) : undefined,
          keys.length > 0 ? inArray(files.objectKey, keys) : undefined,
        ),
      ),
    );
}
