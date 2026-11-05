import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { audit } from "#/server/audit/audit";
import { parseKeys } from "#/server/audit/chain";
import { verifyAuditChain } from "#/server/audit/verify";
import { closeDb, getDb } from "#/server/db/client";
import { makeStaff, makeUser } from "#/test/factories";
import { getOwnerDb, truncateAll } from "#/test/db";

import { MakeAdminError, makeAdmin } from "./make-admin-core.ts";

let client: pg.Client;
const keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);

beforeAll(async () => {
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await closeDb();
});

beforeEach(async () => {
  await truncateAll();
});

async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MakeAdminError) return error.reason;
    throw error;
  }
  return null;
}

describe("makeAdmin", () => {
  it("makes H-001 for the first staff member, then H-002", async () => {
    const first = await makeUser({ email: "a@example.com", emailVerified: true });
    const second = await makeUser({ email: "b@example.com", emailVerified: true });
    expect(await makeAdmin(client, "a@example.com", "Ann", keys)).toEqual({
      userId: first.id,
      staffCode: "H-001",
    });
    expect(await makeAdmin(client, "b@example.com", "Bob", keys)).toEqual({
      userId: second.id,
      staffCode: "H-002",
    });
  });

  it("writes the staff member and an admin role", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    await makeAdmin(client, "a@example.com", "  Ann Admin ", keys);
    const members = await client.query(
      "select display_name from staff_members where user_id = $1",
      [user.id],
    );
    expect(members.rows).toEqual([{ display_name: "Ann Admin" }]);
    const roles = await client.query("select role from staff_roles where user_id = $1", [user.id]);
    expect(roles.rows).toEqual([{ role: "admin" }]);
  });

  it("rejects an unknown email", async () => {
    expect(await reasonOf(makeAdmin(client, "nobody@example.com", "Ann", keys))).toBe("no_user");
  });

  it("rejects an unverified email", async () => {
    await makeUser({ email: "a@example.com", emailVerified: false });
    expect(await reasonOf(makeAdmin(client, "a@example.com", "Ann", keys))).toBe("unverified");
  });

  it("rejects an existing staff member and leaves their roles unchanged", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    await makeStaff({ userId: user.id, roles: ["claims_handler"] });
    expect(await reasonOf(makeAdmin(client, "a@example.com", "Ann", keys))).toBe("already_staff");
    const roles = await client.query("select role from staff_roles where user_id = $1", [user.id]);
    expect(roles.rows).toEqual([{ role: "claims_handler" }]);
  });

  it("rejects an empty or whitespace-only name", async () => {
    await makeUser({ email: "a@example.com", emailVerified: true });
    expect(await reasonOf(makeAdmin(client, "a@example.com", "", keys))).toBe("bad_name");
    expect(await reasonOf(makeAdmin(client, "a@example.com", "   ", keys))).toBe("bad_name");
  });

  it("finds the user whatever the case or padding of the email", async () => {
    const user = await makeUser({ email: "maya@example.com", emailVerified: true });
    const result = await makeAdmin(client, "  Maya@Example.COM ", "Maya", keys);
    expect(result.userId).toBe(user.id);
  });

  it("leaves no staff member behind when the role insert fails", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    const failing = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop !== "query") return Reflect.get(target, prop, receiver);
        return (text: unknown, ...rest: unknown[]) => {
          if (typeof text === "string" && text.includes("insert into staff_roles")) {
            return Promise.reject(new Error("boom"));
          }
          return (target.query as (...args: unknown[]) => unknown)(text, ...rest);
        };
      },
    });
    await expect(makeAdmin(failing, "a@example.com", "Ann", keys)).rejects.toThrow("boom");
    const members = await client.query("select 1 from staff_members where user_id = $1", [user.id]);
    expect(members.rowCount).toBe(0);
  });

  it("writes one staff.added row that verifies together with an app audit row", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    await makeAdmin(client, "a@example.com", "Ann", keys);
    const written = await client.query(
      "select action, entity_type, entity_id, actor_user_id, actor_role, changes from audit_log",
    );
    expect(written.rows).toEqual([
      {
        action: "staff.added",
        entity_type: "user",
        entity_id: user.id,
        actor_user_id: null,
        actor_role: null,
        changes: { roles: ["admin"] },
      },
    ]);
    await getDb().transaction((tx) =>
      audit(tx, { actor: null, action: "claim.viewed", entityType: "claim", entityId: "c1" }),
    );
    expect(await verifyAuditChain(getOwnerDb().$client, keys)).toMatchObject({
      ok: true,
      rows: 2,
    });
  });

  it("writes nothing when the active key is not loaded", async () => {
    await makeUser({ email: "a@example.com", emailVerified: true });
    const noKey = { activeVersion: "v2", keys: new Map<string, Buffer>() };
    await expect(makeAdmin(client, "a@example.com", "Ann", noKey)).rejects.toThrow();
    for (const table of ["staff_members", "staff_roles", "audit_log"]) {
      const result = await client.query(`select 1 from ${table}`);
      expect(result.rowCount, table).toBe(0);
    }
  });
});
