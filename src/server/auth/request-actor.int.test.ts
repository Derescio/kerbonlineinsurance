import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { staffMembers } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeStaff } from "#/test/factories";

import { requirePermission, resolveActor } from "./actor";
import { actorForRequest } from "./request-actor";

// One Actor per request (6.1, from 4.5): a page that calls several server functions reads the
// session and the database once, and nothing carries over to the next request.

beforeEach(truncateAll);
afterAll(closeDb);

describe("actorForRequest", () => {
  it("builds the actor once per request", async () => {
    const request = new Request("http://localhost/account");
    const load = vi.fn(async () => null);
    await actorForRequest(request, load);
    await actorForRequest(request, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("builds it again for the next request", async () => {
    const load = vi.fn(async () => null);
    await actorForRequest(new Request("http://localhost/account"), load);
    await actorForRequest(new Request("http://localhost/account"), load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failed read, so a retry in the same request reads again", async () => {
    const request = new Request("http://localhost/account");
    const load = vi.fn().mockRejectedValueOnce(new Error("database down")).mockResolvedValue(null);
    await expect(actorForRequest(request, load)).rejects.toThrow("database down");
    await expect(actorForRequest(request, load)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refuses a staff member deactivated between two requests", async () => {
    const staff = await makeStaff({ roles: ["claims_handler"] });
    // A session that has given its 2FA code, so only the deactivation can refuse it
    const load = () => resolveActor(getDb(), staff.userId, { twoFactorVerifiedAt: new Date() });
    const first = await actorForRequest(new Request("http://localhost/staff"), load);
    expect(requirePermission(first, "claims.read_all")).toBe(first);

    await getDb()
      .update(staffMembers)
      .set({ deactivatedAt: new Date() })
      .where(eq(staffMembers.userId, staff.userId));
    const second = await actorForRequest(new Request("http://localhost/staff"), load);
    expect(() => requirePermission(second, "claims.read_all")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});
