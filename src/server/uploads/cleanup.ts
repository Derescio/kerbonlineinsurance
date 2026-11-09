import { logSafeError } from "#/server/auth/errors";
import { filesToPurge, markPurged, type Db } from "#/server/data/file-rows";

import type { ObjectStore } from "./store";

// The daily uploads cleanup (4.10 call 12), run by the cron route and `vp run uploads:cleanup`.
// It deletes the objects of uploads never confirmed within 24 hours, of rejected files, and of
// deleted files whose objects are still there (an R2 failure at delete time, or a closure). Each
// file on its own, so one failure doesn't stop the rest. 4.11 moves it onto the jobs table.

export interface CleanupResult {
  purged: number;
  failed: number;
}

export async function runUploadsCleanup(
  db: Db,
  store: ObjectStore,
  now: Date,
  max = 1000,
): Promise<CleanupResult> {
  const result: CleanupResult = { purged: 0, failed: 0 };
  for (const file of await filesToPurge(db, now, max)) {
    try {
      await store.delete(file.objectKey);
      if (file.thumbKey) await store.delete(file.thumbKey);
      await markPurged(db, { ids: [file.id] });
      result.purged++;
    } catch (error) {
      result.failed++;
      // The file's id and the error's class only: a key holds the user id
      console.error("[uploads] cleanup failed:", file.id, logSafeError(error));
    }
  }
  return result;
}
