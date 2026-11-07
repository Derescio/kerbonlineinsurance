import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { sessions } from "#/server/db/schema";
import { LOCAL_URL } from "#/server/auth/origins";
import { env, googleSession, makeAuth, requestHeaders, sessionCookie } from "#/test/auth";
import { truncateAll } from "#/test/db";
import { makeUser } from "#/test/factories";

import { challengeRedirect } from "./guard";
import { readSignInState } from "./sign-in-state";

// The signed-in guard (4.6, call 14): what getSignInState answers for a request's cookies, and
// where /login/two-factor sends each answer.

afterAll(closeDb);

describe("readSignInState", () => {
  beforeEach(async () => {
    await truncateAll();
    // getActor builds the app's auth instance (R8)
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const state = (cookie?: string) => readSignInState(new Headers(cookie ? { cookie } : undefined));

  it("is guest without a session", async () => {
    expect(await state()).toBe("guest");
    expect(await state("better-auth.session_token=forged.signature")).toBe("guest");
  });

  it("is signed_in for a user without 2FA", async () => {
    const user = await makeUser({ emailVerified: true });
    expect(await state(await googleSession(makeAuth(), user.id))).toBe("signed_in");
  });

  it("is needs_code for a 2FA user whose session hasn't given a code", async () => {
    const user = await makeUser({ emailVerified: true, twoFactorEnabled: true });
    expect(await state(await googleSession(makeAuth(), user.id))).toBe("needs_code");
  });

  it("is signed_in once the session is stamped, at once despite the cookie cache", async () => {
    const user = await makeUser({ emailVerified: true, twoFactorEnabled: true });
    const auth = makeAuth();
    const token = await googleSession(auth, user.id);
    // Better Auth's cached copy of the unstamped session, as the browser would hold it
    const cached = await auth.handler(
      new Request(`${LOCAL_URL}/api/auth/get-session`, {
        headers: requestHeaders({ cookie: token }),
      }),
    );
    const cache = sessionCookie(cached);
    expect(cache).toContain("session_data");
    const cookie = `${token}; ${cache}`;
    expect(await state(cookie)).toBe("needs_code");
    await getDb()
      .update(sessions)
      .set({ twoFactorVerifiedAt: new Date() })
      .where(eq(sessions.userId, user.id));
    expect(await state(cookie)).toBe("signed_in");
  });
});

describe("challengeRedirect (Review Focus 2)", () => {
  it("sends a stamped session on to its redirect", () => {
    expect(challengeRedirect("signed_in", "/staff")).toBe("/staff");
  });

  it("sends a stamped session to /account when the redirect is off-site or missing", () => {
    expect(challengeRedirect("signed_in", "//evil.example")).toBe("/account");
    expect(challengeRedirect("signed_in", "https://evil.example")).toBe("/account");
    expect(challengeRedirect("signed_in", undefined)).toBe("/account");
  });

  it("sends a guest to /login", () => {
    expect(challengeRedirect("guest", "/staff")).toBe("/login");
  });

  it("keeps a session owing a code on the page", () => {
    expect(challengeRedirect("needs_code", "/staff")).toBeNull();
  });
});
