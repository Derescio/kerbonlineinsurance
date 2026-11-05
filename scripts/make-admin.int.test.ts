import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb } from "#/server/db/client";
import { makeStaff, makeUser } from "#/test/factories";
import { truncateAll } from "#/test/db";

import { MakeAdminError, makeAdmin } from "./make-admin-core.ts";

let client: pg.Client;

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
    expect(await makeAdmin(client, "a@example.com", "Ann")).toEqual({
      userId: first.id,
      staffCode: "H-001",
    });
    expect(await makeAdmin(client, "b@example.com", "Bob")).toEqual({
      userId: second.id,
      staffCode: "H-002",
    });
  });

  it("writes the staff member and an admin role", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    await makeAdmin(client, "a@example.com", "  Ann Admin ");
    const members = await client.query(
      "select display_name from staff_members where user_id = $1",
      [user.id],
    );
    expect(members.rows).toEqual([{ display_name: "Ann Admin" }]);
    const roles = await client.query("select role from staff_roles where user_id = $1", [user.id]);
    expect(roles.rows).toEqual([{ role: "admin" }]);
  });

  it("rejects an unknown email", async () => {
    expect(await reasonOf(makeAdmin(client, "nobody@example.com", "Ann"))).toBe("no_user");
  });

  it("rejects an unverified email", async () => {
    await makeUser({ email: "a@example.com", emailVerified: false });
    expect(await reasonOf(makeAdmin(client, "a@example.com", "Ann"))).toBe("unverified");
  });

  it("rejects an existing staff member and leaves their roles unchanged", async () => {
    const user = await makeUser({ email: "a@example.com", emailVerified: true });
    await makeStaff({ userId: user.id, roles: ["claims_handler"] });
    expect(await reasonOf(makeAdmin(client, "a@example.com", "Ann"))).toBe("already_staff");
    const roles = await client.query("select role from staff_roles where user_id = $1", [user.id]);
    expect(roles.rows).toEqual([{ role: "claims_handler" }]);
  });

  it("rejects an empty or whitespace-only name", async () => {
    await makeUser({ email: "a@example.com", emailVerified: true });
    expect(await reasonOf(makeAdmin(client, "a@example.com", ""))).toBe("bad_name");
    expect(await reasonOf(makeAdmin(client, "a@example.com", "   "))).toBe("bad_name");
  });

  it("finds the user whatever the case or padding of the email", async () => {
    const user = await makeUser({ email: "maya@example.com", emailVerified: true });
    const result = await makeAdmin(client, "  Maya@Example.COM ", "Maya");
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
    await expect(makeAdmin(failing, "a@example.com", "Ann")).rejects.toThrow("boom");
    const members = await client.query("select 1 from staff_members where user_id = $1", [user.id]);
    expect(members.rowCount).toBe(0);
  });
});
