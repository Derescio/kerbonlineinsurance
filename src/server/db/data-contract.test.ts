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

const pgName = (column: { name: string; keyAsName: boolean }) =>
  column.keyAsName ? snake(column.name) : column.name;

const pgTables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

const tables = pgTables.map((table) => {
  const config = getTableConfig(table);
  const columns = config.columns.map(pgName);
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

  // Review H2: a user id is a pseudonym once names and emails are dropped, and Phase 9 joins on
  // it (a decision to its handler's staff_code), so every copy of it is treated the same way.
  it("treats every user-id column the same way", () => {
    const userIdColumns = [
      ["users", "id"],
      ["staff_members", "user_id"],
      // No foreign key, so they outlive the account (decisions 15 and 16)
      ["audit_log", "actor_user_id"],
      ["events", "user_id"],
      ...pgTables.flatMap((table) => {
        const config = getTableConfig(table);
        return config.foreignKeys.flatMap((foreignKey) => {
          const reference = foreignKey.reference();
          const target = getTableConfig(reference.foreignTable).name;
          if (target !== "users" && target !== "staff_members") return [];
          return reference.columns.map((column) => [config.name, pgName(column)]);
        });
      }),
    ];
    const treatments = userIdColumns
      .filter(([table]) => dataContract[table!]?.copied)
      .map(([table, column]) => `${table}.${column}: ${dataContract[table!]?.columns[column!]}`);
    expect(treatments).toEqual(treatments.map((entry) => entry.replace(/: .*/, ": keep")));
  });
});
