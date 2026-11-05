import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { staffRoles, users } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makeStaff, makeUser } from "#/test/factories";

import { resolveActor } from "./actor";
import { permissionsFor } from "./permissions";

// resolveActor against the test database (4.5): who is asking, from the user id alone.

beforeEach(truncateAll);
afterAll(closeDb);

describe("resolveActor", () => {
  it("gives a plain user no customer and no staff", async () => {
    const user = await makeUser();
    expect(await resolveActor(getDb(), user.id)).toEqual({
      userId: user.id,
      customerId: null,
      staff: null,
    });
  });

  it("carries the customer id", async () => {
    const customer = await makeCustomer();
    const actor = await resolveActor(getDb(), customer.userId);
    expect(actor?.customerId).toBe(customer.id);
    expect(actor?.staff).toBeNull();
  });

  it("gives a handler their role and its permissions", async () => {
    const { userId } = await makeStaff();
    const actor = await resolveActor(getDb(), userId);
    expect(actor?.staff?.roles).toEqual(["claims_handler"]);
    expect(actor?.staff?.displayName).toBe("Sam from Kerb claims");
    expect(actor?.staff?.permissions).toEqual(permissionsFor(["claims_handler"]));
  });

  it("unions the permissions of two roles", async () => {
    const { userId } = await makeStaff({ roles: ["claims_handler", "admin"] });
    const actor = await resolveActor(getDb(), userId);
    expect([...(actor?.staff?.roles ?? [])].sort()).toEqual(["admin", "claims_handler"]);
    expect(actor?.staff?.permissions).toEqual(permissionsFor(["claims_handler", "admin"]));
  });

  it("treats a deactivated staff member as not staff", async () => {
    const { userId } = await makeStaff({
      startedAt: new Date("2019-01-01"),
      deactivatedAt: new Date("2020-01-01"),
    });
    expect((await resolveActor(getDb(), userId))?.staff).toBeNull();
  });

  it("loses a role's permissions once the role row is deleted", async () => {
    const { userId } = await makeStaff({ roles: ["claims_handler", "admin"] });
    expect((await resolveActor(getDb(), userId))?.staff?.permissions.has("staff.manage")).toBe(
      true,
    );
    await getDb()
      .delete(staffRoles)
      .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, "admin")));
    const actor = await resolveActor(getDb(), userId);
    expect(actor?.staff?.roles).toEqual(["claims_handler"]);
    expect(actor?.staff?.permissions.has("staff.manage")).toBe(false);
  });

  it("keeps a staff member with every role removed, with nothing they can do", async () => {
    const { userId } = await makeStaff();
    await getDb().delete(staffRoles).where(eq(staffRoles.userId, userId));
    const actor = await resolveActor(getDb(), userId);
    expect(actor?.staff).not.toBeNull();
    expect(actor?.staff?.roles).toEqual([]);
    expect(actor?.staff?.permissions.size).toBe(0);
  });

  it("returns null for an unknown user id", async () => {
    expect(await resolveActor(getDb(), "no-such-user")).toBeNull();
  });

  it("returns null for a deleted user", async () => {
    const user = await makeUser();
    await getDb().delete(users).where(eq(users.id, user.id));
    expect(await resolveActor(getDb(), user.id)).toBeNull();
  });
});
