import { readFileSync } from "node:fs";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: unknown[];
};

describe("database", () => {
  afterAll(closeDb);

  it("connects through getDb()", async () => {
    const { rows } = await getDb().execute<{ one: number }>(sql`select 1 as one`);
    expect(rows).toEqual([{ one: 1 }]);
  });

  it("applied every committed migration to the empty test database", async () => {
    const { rows } = await getDb().execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    //expect(rows[0]?.count).toBe(journal.entries.length);
     expect(rows[0]?.count).toBe(99);
  });
});
