import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, integer, timestamp, uuid } from "drizzle-orm/pg-core";

// Shared column builders and check helpers for the schema files. Column names come from the TS
// keys through `casing: "snake_case"` (client.ts, drizzle.config.ts).

/** A time-ordered uuid (Postgres 18's built-in uuidv7(), 4.2 decision 3). */
export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

/** Defaults only, never forced, so the 4.9 seed can backdate history (decision 16). */
export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Money is integer pence. */
export const pence = () => integer().notNull();

/** `column in ('a', 'b')`: statuses and other closed sets are checked by Postgres. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

/** `area.verb` names (audit actions, events, notification types), e.g. `claim.status_changed`. */
export function areaVerb(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[a-z][a-z_]*\\.[a-z][a-z_]*$'`;
}

/** Card and bank "last four": exactly four digits, never more of the number. */
export function lastFour(column: AnyPgColumn): SQL {
  return sql`${column} ~ '^[0-9]{4}$'`;
}

/**
 * The outward code of a UK postcode (`SW1A 1AA` → `SW1A`), stored so the pipeline copies the
 * district, never the full postcode (decision 16). The inward code is always three characters.
 */
export const postcodeDistrictSql = sql`left(upper(replace(postcode, ' ', '')), -3)`;
