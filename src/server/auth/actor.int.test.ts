import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { staffRoles, users } from "#/server/db/schema";
import { env, googleSession, makeAuth } from "#/test/auth";
import { tamper, truncateAll } from "#/test/db";
import { makeCustomer, makeStaff, makeUser } from "#/test/factories";

import { getActor, resolveActor } from "./actor";
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
      twoFactor: { enabled: false, verifiedAt: null },
    });
  });

  it("reads two_factor_enabled", async () => {
    const on = await makeUser({ twoFactorEnabled: true });
    const off = await makeUser();
    expect((await resolveActor(getDb(), on.id))?.twoFactor.enabled).toBe(true);
    expect((await resolveActor(getDb(), off.id))?.twoFactor.enabled).toBe(false);
  });

  it("takes verifiedAt from the session passed in", async () => {
    const user = await makeUser({ twoFactorEnabled: true });
    const stamp = new Date("2026-06-01T10:00:00Z");
    expect((await resolveActor(getDb(), user.id))?.twoFactor.verifiedAt).toBeNull();
    expect(
      (await resolveActor(getDb(), user.id, { twoFactorVerifiedAt: stamp }))?.twoFactor.verifiedAt,
    ).toEqual(stamp);
    expect(
      (await resolveActor(getDb(), user.id, { twoFactorVerifiedAt: null }))?.twoFactor.verifiedAt,
    ).toBeNull();
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

describe("getActor", () => {
  // getAuth() reads the auth environment, which the integration project doesn't set. Give it the
  // same values makeAuth() signs with, so the cookie verifies.
  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("carries the session's stamp", async () => {
    const user = await makeUser({ twoFactorEnabled: true });
    const cookie = await googleSession(makeAuth(), user.id);
    const stamp = new Date("2026-06-01T10:00:00.000Z");
    await tamper("update sessions set two_factor_verified_at = $1 where user_id = $2", [
      stamp,
      user.id,
    ]);
    const actor = await getActor(new Headers({ cookie }));
    expect(actor?.userId).toBe(user.id);
    expect(actor?.twoFactor).toEqual({ enabled: true, verifiedAt: stamp });
  });
});
