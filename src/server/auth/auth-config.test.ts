import type { BetterAuthOptions } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vite-plus/test";

import type { Db } from "#/server/db/client";
import * as schema from "#/server/db/schema";
import { env } from "#/test/auth";

import { createAuth } from "./auth";

// "Sign out everywhere" deletes sessions rows itself instead of calling Better Auth's
// deleteUserSessions (4.6, call 11). That's only the same thing while Better Auth has no
// secondaryStorage and no session delete hook: adding either fails this test, so the call gets
// revisited. sessions.int.test.ts checks the two leave the database the same.

describe("the auth config (4.6, call 11)", () => {
  // A mock database: building the config must not connect
  const auth = createAuth({
    db: drizzle.mock({ schema, casing: "snake_case" }) as unknown as Db,
    env,
    sendEmail: async () => {},
    captcha: false,
    breachCheck: false,
    rateLimit: false,
  });

  // Widened: the inferred type lists only the keys we set, so a missing one wouldn't type-check
  const options: BetterAuthOptions = auth.options;

  it("has no secondaryStorage", () => {
    expect(options.secondaryStorage).toBeUndefined();
  });

  it("has no session delete hook", () => {
    expect(options.databaseHooks?.session?.delete).toBeUndefined();
  });

  it("has neither once the plugins are merged in", async () => {
    // A plugin's init() can add hooks; the context holds the merged options
    const merged: BetterAuthOptions = (await auth.$context).options;
    expect(merged.secondaryStorage).toBeUndefined();
    expect(merged.databaseHooks?.session?.delete).toBeUndefined();
  });
});
