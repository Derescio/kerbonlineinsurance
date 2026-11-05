import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { audit } from "#/server/audit/audit";
import { parseKeys } from "#/server/audit/chain";
import { closeDb, getDb } from "#/server/db/client";
import { TEST_DATABASE_URL, tamper, truncateAll } from "#/test/db";

import { checkAppRole } from "./check-app-role-core.ts";

const keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);

beforeEach(truncateAll);
afterAll(closeDb);

async function runAs(url: string | undefined) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await checkAppRole(client, keys);
  } finally {
    await client.end();
  }
}

async function writeRows() {
  for (const entityId of ["a", "b"]) {
    await getDb().transaction((tx) =>
      audit(tx, { actor: null, action: "claim.viewed", entityType: "claim", entityId }, keys),
    );
  }
}

describe("checkAppRole", () => {
  it("passes every check as kerb_app", async () => {
    await writeRows();
    const results = await runAs(process.env.DATABASE_URL);
    expect(results.map((r) => r.name)).toEqual([
      "connected as kerb_app",
      "no superuser, CREATEROLE, CREATEDB or BYPASSRLS",
      "not a member of neon_superuser or any pg_*_data role",
      "UPDATE, DELETE and TRUNCATE on audit_log refused",
      "audit_log triggers present",
      "audit chain verifies",
    ]);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("fails the role checks as the owner", async () => {
    const byName = new Map((await runAs(TEST_DATABASE_URL)).map((r) => [r.name, r.ok]));
    expect(byName.get("connected as kerb_app")).toBe(false);
    expect(byName.get("no superuser, CREATEROLE, CREATEDB or BYPASSRLS")).toBe(false);
    expect(byName.get("UPDATE, DELETE and TRUNCATE on audit_log refused")).toBe(false);
  });

  it("fails the chain check after a row is tampered with", async () => {
    await writeRows();
    await tamper(
      "update audit_log set action = 'claim.edited' where id = (select min(id) from audit_log)",
    );
    const results = await runAs(process.env.DATABASE_URL);
    const chain = results.find((r) => r.name === "audit chain verifies");
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toMatch(/^row \d+: hash_mismatch$/);
  });
});
