import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { getOwnerDb } from "#/test/db";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: unknown[];
};

describe("database", () => {
  afterAll(closeDb);

  it("connects through getDb()", async () => {
    const { rows } = await getDb().execute<{ one: number }>(sql`select 1 as one`);
    expect(rows).toEqual([{ one: 1 }]);
  });

  it("connects as kerb_app", async () => {
    const { rows } = await getDb().execute<{ user: string }>(sql`select current_user as user`);
    expect(rows).toEqual([{ user: "kerb_app" }]);
  });

  // kerb_app can't read the drizzle schema (the audit-integrity spec, call 8)
  it("applied every committed migration to the empty test database", async () => {
    const { rows } = await getOwnerDb().execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(rows[0]?.count).toBe(journal.entries.length);
  });
});
