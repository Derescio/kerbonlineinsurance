import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vite-plus/test";

import { dataContract } from "./data-contract";
import * as schema from "./schema";

// Column names as Postgres has them: our tables take theirs from the TS key through
// `casing: "snake_case"`; the generated auth tables name theirs explicitly.
function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) =>
      column.keyAsName ? snake(column.name) : column.name,
    );
    const primaryKey = [
      ...config.columns.filter((column) => column.primary).map((column) => column.name),
      ...config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
    ].map((name) => (columns.includes(name) ? name : snake(name)));
    return { name: config.name, columns, primaryKey };
  });

describe("data contract (4.2, decision 17)", () => {
  it("covers every table in the schema, and names no other", () => {
    expect(Object.keys(dataContract).sort()).toEqual(tables.map(({ name }) => name).sort());
  });

  describe.each(tables)("$name", ({ name, columns, primaryKey }) => {
    const entry = dataContract[name];

    it("lists every column, and no column that doesn't exist", () => {
      expect(Object.keys(entry?.columns ?? {}).sort()).toEqual([...columns].sort());
    });

    it("names the real primary key", () => {
      expect(entry?.primaryKey).toEqual(primaryKey);
    });

    it("gives a copied table a change column that exists", () => {
      if (!entry?.copied) return;
      expect(columns).toContain(entry.changeColumn);
    });
  });
});
