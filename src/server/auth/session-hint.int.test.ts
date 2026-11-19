import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { users } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeAuth, requestHeaders, sessionCookie, signInWithPassword, signUp } from "#/test/auth";

import { sessionHintResponse } from "./session-hint";

// The public header's "My account" (6.1, decision 8): an uncached answer to "is anyone signed in?",
// so the CDN-cached pages never change.

beforeEach(truncateAll);
afterAll(closeDb);

async function hint(auth: ReturnType<typeof makeAuth>, cookie?: string) {
  const response = await sessionHintResponse(
    requestHeaders(cookie === undefined ? {} : { cookie }),
    auth,
  );
  return { response, body: (await response.json()) as { signedIn: boolean } };
}

describe("sessionHintResponse", () => {
  it("says signed in for a session cookie", async () => {
    const auth = makeAuth();
    const { user } = await signUp(auth);
    await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
    const cookie = sessionCookie(await signInWithPassword(auth, user.email));

    const { response, body } = await hint(auth, cookie);
    expect(body).toEqual({ signedIn: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("says signed out with no cookie, or a cookie that isn't a session", async () => {
    const auth = makeAuth();
    for (const cookie of [undefined, "better-auth.session_token=nonsense"]) {
      const { response, body } = await hint(auth, cookie);
      expect(body).toEqual({ signedIn: false });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
