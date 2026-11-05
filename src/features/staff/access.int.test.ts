import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveActor } from "#/server/auth/actor";
import { closeDb, getDb } from "#/server/db/client";
import { truncateAll } from "#/test/db";
import { makeCustomer, makeStaff } from "#/test/factories";

import { staffAccessFor } from "./access";

// What the /staff route guard decides (4.5), from the real actor resolution.

beforeEach(truncateAll);
afterAll(closeDb);

describe("staffAccessFor", () => {
  it("treats a signed-out visitor as a guest", () => {
    expect(staffAccessFor(null)).toBe("guest");
  });

  it("treats a customer as a customer", async () => {
    const customer = await makeCustomer();
    expect(staffAccessFor(await resolveActor(getDb(), customer.userId))).toBe("customer");
  });

  it("treats a deactivated handler as a customer", async () => {
    const { userId } = await makeStaff({
      startedAt: new Date("2019-01-01"),
      deactivatedAt: new Date("2020-01-01"),
    });
    expect(staffAccessFor(await resolveActor(getDb(), userId))).toBe("customer");
  });

  it("treats staff with no roles as a customer, since they hold no permission", async () => {
    const { userId } = await makeStaff({ roles: [] });
    expect(staffAccessFor(await resolveActor(getDb(), userId))).toBe("customer");
  });

  it("lets a handler in", async () => {
    const { userId } = await makeStaff();
    expect(staffAccessFor(await resolveActor(getDb(), userId))).toBe("staff");
  });
});
