import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { securityEvents, sessions } from "#/server/db/schema";
import {
  enableTwoFactor,
  googleSession,
  makeAuth,
  post,
  requestHeaders,
  sent,
  sessionCookie,
  signInWithPassword,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { truncateAll } from "#/test/db";
import { makeStaff } from "#/test/factories";
import { totpNow } from "#/test/totp";

import { LOCAL_URL } from "./origins";
import { TWO_FACTOR_ALLOWLIST } from "./two-factor";

// kerbTwoFactor() part 1 (4.6, calls 4, 5 and 10): stamping the session that passed a code, the
// session-owes-a-code allowlist, and sign_in recorded after the code instead of after the password.

const EMAIL = "maya.patel@example.com";

/** Sign up and open the confirmation link, as auth.int.test.ts does; returns the link's session */
async function signUpAndConfirm(auth: TestAuth, email = EMAIL) {
  const { user } = await signUp(auth, email);
  const message = sent
    .filter((mail) => mail.to === email && mail.subject === "Confirm your email for Kerb")
    .at(-1);
  const url = /(http\S+verify-email\?token=\S+)/.exec(message!.text)![1]!;
  const response = await auth.handler(new Request(url, { headers: requestHeaders() }));
  return { user, cookie: sessionCookie(response) };
}

/** A confirmed user with TOTP on (R2: the real enrolment, not just the flag) */
async function twoFactorUser(auth: TestAuth, email = EMAIL) {
  const { user, cookie } = await signUpAndConfirm(auth, email);
  const enabled = await enableTwoFactor(auth, cookie);
  return { user, ...enabled };
}

function get(auth: TestAuth, path: string, cookie: string) {
  return auth.handler(
    new Request(`${LOCAL_URL}/api/auth${path}`, { headers: requestHeaders({ cookie }) }),
  );
}

const sessionsFor = (userId: string) =>
  getDb().select().from(sessions).where(eq(sessions.userId, userId));

const eventCount = async (userId: string, type: "sign_in" | "two_factor_passed") =>
  (
    await getDb()
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, userId), eq(securityEvents.type, type)))
  ).length;

/** Within 5 seconds of now */
function expectRecent(date: Date | null | undefined) {
  expect(date).toBeInstanceOf(Date);
  expect(Math.abs(Date.now() - date!.getTime())).toBeLessThan(5000);
}

/** Only the cookies named `part` from a Cookie header value */
const pick = (cookie: string, part: string) =>
  cookie
    .split("; ")
    .filter((pair) => pair.split("=")[0]!.includes(part))
    .join("; ");

describe("kerbTwoFactor (4.6)", () => {
  beforeEach(async () => {
    await truncateAll();
    sent.length = 0;
  });
  afterAll(closeDb);

  it("a sign-in code stamps the new session", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret) },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    const { token } = (await verify.json()) as { token: string };
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
    expect(row!.userId).toBe(user.id);
    expectRecent(row!.twoFactorVerifiedAt);
  });

  it("the setup code stamps the session that survives", async () => {
    const auth = makeAuth();
    const { user, cookie } = await signUpAndConfirm(auth);
    const [before] = await sessionsFor(user.id);
    expect(before!.twoFactorVerifiedAt).toBeNull();
    await enableTwoFactor(auth, cookie);
    const rows = await sessionsFor(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).not.toBe(before!.token);
    expectRecent(rows[0]!.twoFactorVerifiedAt);
  });

  it("a signed-in code stamps the same session", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const owing = (await sessionsFor(user.id)).find((row) => row.twoFactorVerifiedAt === null)!;
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret) },
      { cookie },
    );
    expect(verify.status).toBe(200);
    const [after] = await getDb().select().from(sessions).where(eq(sessions.id, owing.id));
    expect(after!.token).toBe(owing.token);
    expectRecent(after!.twoFactorVerifiedAt);
  });

  it("a backup code stamps too, with method backup_code", async () => {
    const auth = makeAuth();
    const { user, backupCodes } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    const { token } = (await verify.json()) as { token: string };
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
    expectRecent(row!.twoFactorVerifiedAt);
    const passed = await getDb()
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, user.id), eq(securityEvents.type, "two_factor_passed")));
    // The setup code passed with totp first
    expect(passed.map((event) => event.method)).toEqual(["totp", "backup_code"]);
  });

  it("sign_in is recorded once, after the code", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    expect(await eventCount(user.id, "sign_in")).toBe(0);
    // The setup code doesn't count: only the sign-in's
    const passedBefore = await eventCount(user.id, "two_factor_passed");
    await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret) },
      { cookie: sessionCookie(signIn) },
    );
    expect(await eventCount(user.id, "sign_in")).toBe(1);
    expect((await eventCount(user.id, "two_factor_passed")) - passedBefore).toBe(1);
  });

  it("a session owing a code is refused everywhere else", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const refused = [
      ["POST", "/two-factor/enable", { password: "x" }],
      ["POST", "/two-factor/get-totp-uri", { password: "x" }],
      ["POST", "/two-factor/generate-backup-codes", {}],
      ["POST", "/two-factor/disable", {}],
      ["POST", "/change-password", { currentPassword: "x", newPassword: "y" }],
      ["POST", "/revoke-sessions", {}],
      ["POST", "/update-user", { name: "Someone" }],
      ["GET", "/list-sessions", null],
    ] as const;
    for (const [method, path, body] of refused) {
      const response =
        method === "GET" ? await get(auth, path, cookie) : await post(auth, path, body, { cookie });
      expect([path, response.status]).toEqual([path, 401]);
      expect(await response.json()).toMatchObject({ code: "TWO_FACTOR_CHALLENGE" });
    }
    // Nothing changed behind the refusals
    expect((await sessionsFor(user.id)).length).toBeGreaterThan(1);

    expect((await get(auth, "/get-session", cookie)).status).toBe(200);
    const other = await googleSession(auth, user.id);
    expect((await post(auth, "/sign-out", {}, { cookie: other })).status).toBe(200);

    await post(auth, "/two-factor/verify-totp", { code: await totpNow(secret) }, { cookie });
    expect((await get(auth, "/list-sessions", cookie)).status).toBe(200);
  });

  it("the allowlist is the verify endpoints, sign-out, get-session and Google's routes", () => {
    expect([...TWO_FACTOR_ALLOWLIST].sort()).toEqual(
      [
        "/two-factor/verify-totp",
        "/two-factor/verify-backup-code",
        "/sign-out",
        "/get-session",
        "/sign-in/social",
        "/oauth-proxy-callback",
      ].sort(),
    );
  });

  it("a customer's trusted device is stamped at sign-in", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret), trustDevice: true },
      { cookie: sessionCookie(signIn) },
    );
    const trust = pick(sessionCookie(verify), "trust_device");
    expect(trust).not.toBe("");
    await post(auth, "/sign-out", {}, { cookie: sessionCookie(verify) });

    const again = await post(
      auth,
      "/sign-in/email",
      { email: EMAIL, password: "correct horse battery" },
      {
        cookie: trust,
      },
    );
    expect(again.status).toBe(200);
    const body = (await again.json()) as { token?: string; twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBeUndefined();
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, body.token!));
    expect(row!.userId).toBe(user.id);
    expectRecent(row!.twoFactorVerifiedAt);
    expect(await eventCount(user.id, "sign_in")).toBe(2);
  });

  it("a staff member's old trusted device gets a session but no stamp (call 8)", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret), trustDevice: true },
      { cookie: sessionCookie(signIn) },
    );
    const trust = pick(sessionCookie(verify), "trust_device");
    // Trusted while still a customer, then made staff
    await makeStaff({ userId: user.id });

    const again = await post(
      auth,
      "/sign-in/email",
      { email: EMAIL, password: "correct horse battery" },
      {
        cookie: trust,
      },
    );
    expect(again.status).toBe(200);
    const { token } = (await again.json()) as { token: string };
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
    expect(row!.twoFactorVerifiedAt).toBeNull();
  });

  it("an owing session's cached cookie still owes a code after its row is gone", async () => {
    // A real owing session with a cookie cache: staff arriving through an old trusted device
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret), trustDevice: true },
      { cookie: sessionCookie(signIn) },
    );
    await makeStaff({ userId: user.id });
    const again = await post(
      auth,
      "/sign-in/email",
      { email: EMAIL, password: "correct horse battery" },
      {
        cookie: pick(sessionCookie(verify), "trust_device"),
      },
    );
    const cookie = sessionCookie(again);
    expect(cookie).toContain("session_data");
    // /sign-out is allowed and deletes the row; the old cookies are kept and replayed
    expect((await post(auth, "/sign-out", {}, { cookie })).status).toBe(200);
    for (const response of [
      await get(auth, "/list-sessions", cookie),
      await post(auth, "/two-factor/generate-backup-codes", {}, { cookie }),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "TWO_FACTOR_CHALLENGE" });
    }
  });

  it("kerbTrustDevice is false for staff and true for customers", async () => {
    const auth = makeAuth();
    await twoFactorUser(auth);
    const customer = await signInWithPassword(auth, EMAIL);
    expect(await customer.json()).toMatchObject({ twoFactorRedirect: true, kerbTrustDevice: true });

    const staffEmail = "sam.okafor@example.com";
    const { user } = await twoFactorUser(auth, staffEmail);
    await makeStaff({ userId: user.id });
    const staff = await signInWithPassword(auth, staffEmail);
    expect(await staff.json()).toMatchObject({ twoFactorRedirect: true, kerbTrustDevice: false });
  });
});
