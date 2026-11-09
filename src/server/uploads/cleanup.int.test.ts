import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { files } from "#/server/db/schema";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeFile } from "#/test/factories";

import { runUploadsCleanup } from "./cleanup";
import { MemoryObjectStore } from "./store-memory";

// The daily uploads cleanup (4.10, call 12): stale uploads, rejected files and deleted files whose
// objects are still there lose their objects; everything else is left alone.

let store: MemoryObjectStore;

afterAll(closeDb);
beforeEach(async () => {
  await truncateAll();
  store = new MemoryObjectStore();
});

async function stored(overrides: Parameters<typeof makeFile>[0], hoursAgo = 0) {
  const file = await makeFile(overrides);
  // The owner, so created_at can be backdated
  await getOwnerDb()
    .update(files)
    .set({ createdAt: sql`now() - make_interval(hours => ${hoursAgo})` })
    .where(eq(files.id, file.id));
  store.put(file.objectKey, new Uint8Array([1]), file.mime);
  if (file.thumbKey) store.put(file.thumbKey, new Uint8Array([1]), file.mime);
  return file;
}

const row = async (id: string) => (await getDb().select().from(files).where(eq(files.id, id)))[0]!;

describe("runUploadsCleanup", () => {
  it("purges stale uploads, rejected files and leftover deleted ones, and nothing else", async () => {
    const stale = await stored({ status: "pending" }, 25);
    const rejected = await stored({ status: "rejected" });
    const deleted = await stored({ status: "deleted" });
    const fresh = await stored({ status: "pending" }, 1);
    const ready = await stored({ status: "ready" }, 48);
    const purged = await stored({ status: "deleted", purgedAt: new Date() });

    expect(await runUploadsCleanup(getDb(), store, new Date())).toEqual({ purged: 3, failed: 0 });

    for (const file of [stale, rejected, deleted]) {
      expect(store.has(file.objectKey)).toBe(false);
      expect(store.has(file.thumbKey!)).toBe(false);
      expect((await row(file.id)).purgedAt).not.toBeNull();
    }
    expect((await row(stale.id)).status).toBe("deleted");
    expect((await row(rejected.id)).status).toBe("rejected");
    for (const file of [fresh, ready, purged]) expect(store.has(file.objectKey)).toBe(true);
    expect((await row(fresh.id)).status).toBe("pending");
    expect((await row(ready.id)).purgedAt).toBeNull();
  });

  it("a second run finds nothing", async () => {
    await stored({ status: "rejected" });
    await runUploadsCleanup(getDb(), store, new Date());
    expect(await runUploadsCleanup(getDb(), store, new Date())).toEqual({ purged: 0, failed: 0 });
  });

  it("one failing delete doesn't stop the others, and logs no key", async () => {
    const first = await stored({ status: "deleted" });
    const second = await stored({ status: "deleted" });
    const real = store.delete.bind(store);
    vi.spyOn(store, "delete").mockImplementation(async (key) => {
      if (key === first.objectKey) throw new Error(`R2 refused ${key}`);
      return real(key);
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runUploadsCleanup(getDb(), store, new Date())).toEqual({ purged: 1, failed: 1 });
    expect((await row(first.id)).purgedAt).toBeNull();
    expect((await row(second.id)).purgedAt).not.toBeNull();
    expect(logged).toHaveBeenCalledWith("[uploads] cleanup failed:", first.id, { name: "Error" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(first.objectKey);
  });
});
