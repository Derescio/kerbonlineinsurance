import { logSafeError } from "#/server/auth/errors";
import * as rows from "#/server/data/file-rows";
import type { Tx } from "#/server/db/tx";
import { getObjectStore } from "#/server/uploads/store";

// The R2 hook for the immediate delete (4.7 call 17, filled in by 4.10 call 11). deleteUserFiles
// runs inside the delete's transaction, after the audit row and before the users row goes, so a
// throw here rolls the whole delete back. It marks the user's files `deleted` and returns their
// object keys; purgeObjects deletes those objects after the commit. If R2 is down then, the rows
// keep purged_at empty and the daily cleanup deletes the objects later.

export async function deleteUserFiles(tx: Tx, userId: string): Promise<string[]> {
  return rows.deleteUserFiles(tx, userId);
}

export async function purgeObjects(keys: string[]): Promise<void> {
  try {
    const store = getObjectStore();
    for (const key of keys) await store.delete(key);
    await rows.markPurged(rows.uploadsDb(), { objectKeys: keys });
  } catch (error) {
    // The error's class only: never a key, which holds the user id
    console.error("[uploads] purge after delete failed:", logSafeError(error));
  }
}

/** Called through this object, so a test can spy on it or make it throw */
export const filesHook = { deleteUserFiles, purgeObjects };
