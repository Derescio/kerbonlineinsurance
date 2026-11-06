import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import {
  auditLog,
  securityEvents,
  sessions,
  twoFactors,
  users,
  verifications,
  type SecurityEventType,
} from "#/server/db/schema";
import { verifyAuditChain } from "#/server/audit/verify";
import { getAuditEnv } from "#/server/env";
import {
  enableTwoFactor,
  env,
  googleSession,
  makeAuth,
  PASSWORD,
  post,
  requestHeaders,
  sent,
  sessionCookie,
  signInWithPassword,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { tamper, truncateAll } from "#/test/db";
import { makeStaff, makeUser } from "#/test/factories";
import { totpNow } from "#/test/totp";

import { getActor, requirePermission } from "./actor";
import { LOCAL_URL } from "./origins";
import { TWO_FACTOR_ALLOWLIST } from "./two-factor";

// kerbTwoFactor() part 1 (4.6, calls 4, 5 and 10): stamping the session that passed a code, the
// session-owes-a-code allowlist, and sign_in recorded after the code instead of after the password.

const EMAIL = "maya.patel@example.com";

afterAll(closeDb);

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

const eventCount = async (
  userId: string,
  type: "sign_in" | "two_factor_passed" | "two_factor_failed",
) =>
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
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row!.name).toBe("Maya Patel");
    expect(row!.twoFactorEnabled).toBe(true);

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

  it("a backup code can't confirm setup, and stamps and records nothing", async () => {
    const auth = makeAuth();
    const { user, cookie } = await signUpAndConfirm(auth);
    const enabled = await post(auth, "/two-factor/enable", { password: PASSWORD }, { cookie });
    const { backupCodes } = (await enabled.json()) as { backupCodes: string[] };
    const verify = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie },
    );
    expect(verify.status).toBe(400);
    expect(await verify.json()).toMatchObject({ code: "TWO_FACTOR_NOT_ENABLED" });
    const rows = await sessionsFor(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.twoFactorVerifiedAt).toBeNull();
    expect(await eventCount(user.id, "two_factor_passed")).toBe(0);
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row!.twoFactorEnabled).toBe(false);
  });

  it("refuses disableSession on the verify paths, and records nothing", async () => {
    const auth = makeAuth();
    const { user, backupCodes, secret } = await twoFactorUser(auth);
    const signIn = await signInWithPassword(auth, EMAIL);
    for (const [path, code] of [
      ["/two-factor/verify-backup-code", backupCodes[0]!],
      ["/two-factor/verify-totp", await totpNow(secret)],
    ] as const) {
      const response = await post(
        auth,
        path,
        { code, disableSession: true },
        { cookie: sessionCookie(signIn) },
      );
      expect([path, response.status]).toEqual([path, 400]);
      expect(await response.json()).toMatchObject({ code: "DISABLE_SESSION_NOT_ALLOWED" });
    }
    expect(await eventCount(user.id, "sign_in")).toBe(0);
    // Only the setup code's
    expect(await eventCount(user.id, "two_factor_passed")).toBe(1);
  });

  it("a wrong code stamps nothing and records no two_factor_passed, in either mode", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    // A real code, but for 1970
    const wrong = await totpNow(secret, new Date(0));

    const signIn = await signInWithPassword(auth, EMAIL);
    const signInMode = await post(
      auth,
      "/two-factor/verify-totp",
      { code: wrong },
      { cookie: sessionCookie(signIn) },
    );
    expect(signInMode.status).toBe(401);

    const cookie = await googleSession(auth, user.id);
    const signedIn = await post(auth, "/two-factor/verify-totp", { code: wrong }, { cookie });
    expect(signedIn.status).toBe(401);

    const unstamped = (await sessionsFor(user.id)).filter((r) => r.twoFactorVerifiedAt === null);
    // The Google session only: the sign-in made no session
    expect(unstamped).toHaveLength(1);
    expect(await sessionsFor(user.id)).toHaveLength(2);
    expect(await eventCount(user.id, "two_factor_passed")).toBe(1);
    expect(await eventCount(user.id, "sign_in")).toBe(0);
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

// kerbTwoFactor() part 2 (4.6, calls 7, 8 and 9): staff rules, the passwordless freshness check and
// the signed-in lockout.
describe("kerbTwoFactor part 2 (4.6)", () => {
  beforeEach(async () => {
    await truncateAll();
    sent.length = 0;
  });

  /** A real TOTP code, but for 1970 */
  const wrongCode = (secret: string) => totpNow(secret, new Date(0));

  const twoFactorRow = async (userId: string) =>
    (await getDb().select().from(twoFactors).where(eq(twoFactors.userId, userId)))[0]!;

  const trustRows = async () =>
    (await getDb().select().from(verifications)).filter((row) =>
      row.identifier.startsWith("trust-device-"),
    );

  const verifyTotp = (auth: TestAuth, code: string, cookie: string) =>
    post(auth, "/two-factor/verify-totp", { code }, { cookie });

  it("staff: trustDevice is stripped", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    await makeStaff({ userId: user.id });
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret), trustDevice: true },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    // The sign-in itself still works and is stamped
    const { token } = (await verify.json()) as { token: string };
    const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
    expectRecent(row!.twoFactorVerifiedAt);
    expect(pick(sessionCookie(verify), "trust_device")).toBe("");
    expect(await trustRows()).toHaveLength(0);
  });

  it("staff: trustDevice is stripped from a backup code too", async () => {
    const auth = makeAuth();
    const { user, backupCodes } = await twoFactorUser(auth);
    await makeStaff({ userId: user.id });
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: backupCodes[0], trustDevice: true },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    expect(pick(sessionCookie(verify), "trust_device")).toBe("");
    expect(await trustRows()).toHaveLength(0);
  });

  it("staff: disable is refused", async () => {
    const auth = makeAuth();
    const { user, cookie } = await twoFactorUser(auth);
    await makeStaff({ userId: user.id });
    const response = await post(auth, "/two-factor/disable", { password: PASSWORD }, { cookie });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "TWO_FACTOR_REQUIRED",
      message: "Staff accounts need two-factor. Set it up to continue.",
    });
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row!.twoFactorEnabled).toBe(true);
  });

  describe("with the app's auth instance", () => {
    beforeEach(() => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("an old trust cookie still leads to a challenge for staff", async () => {
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
      // Trusted while still a customer, then made staff
      await makeStaff({ userId: user.id });

      const again = await post(
        auth,
        "/sign-in/email",
        { email: EMAIL, password: PASSWORD },
        { cookie: trust },
      );
      expect(again.status).toBe(200);
      const { token } = (await again.json()) as { token: string };
      const [row] = await getDb().select().from(sessions).where(eq(sessions.token, token));
      expect(row!.twoFactorVerifiedAt).toBeNull();

      const actor = await getActor(new Headers({ cookie: sessionCookie(again) }));
      expect(actor?.userId).toBe(user.id);
      expect(() => requirePermission(actor, "claims.read_all")).toThrow(
        expect.objectContaining({ code: "TWO_FACTOR_CHALLENGE" }),
      );
    });
  });

  it("a Google-only user needs a session under 10 minutes old", async () => {
    const auth = makeAuth();
    const user = await makeUser({ emailVerified: true });
    const cookie = await googleSession(auth, user.id);
    const age = (minutes: number) =>
      tamper(
        `update sessions set created_at = now() - interval '${minutes} minutes' where user_id = $1`,
        [user.id],
      );
    await age(11);
    const stale = await post(auth, "/two-factor/enable", {}, { cookie });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({
      code: "SESSION_NOT_FRESH",
      message: "Confirm it's you to continue.",
    });
    // The other passwordless 2FA changes are held to the same rule
    for (const path of [
      "/two-factor/get-totp-uri",
      "/two-factor/generate-backup-codes",
      "/two-factor/disable",
    ]) {
      const response = await post(auth, path, {}, { cookie });
      expect([path, response.status]).toEqual([path, 403]);
      expect(await response.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    }

    await age(9);
    const fresh = await post(auth, "/two-factor/enable", {}, { cookie });
    expect(fresh.status).toBe(200);
  });

  it("a password user needs the password", async () => {
    const auth = makeAuth();
    const { user, cookie } = await signUpAndConfirm(auth);
    // An old session: the password is what's checked, not the session's age
    await tamper("update sessions set created_at = now() - interval '1 hour' where user_id = $1", [
      user.id,
    ]);
    const without = await post(auth, "/two-factor/enable", {}, { cookie });
    expect([400, 401]).toContain(without.status);
    expect(await without.json()).not.toMatchObject({ code: "SESSION_NOT_FRESH" });
    const withPassword = await post(auth, "/two-factor/enable", { password: PASSWORD }, { cookie });
    expect(withPassword.status).toBe(200);
  });

  it("the sign-in challenge is used up after 5 wrong codes", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = sessionCookie(await signInWithPassword(auth, EMAIL));
    const wrong = await wrongCode(secret);
    for (let i = 0; i < 5; i++) {
      expect((await verifyTotp(auth, wrong, cookie)).status).toBe(401);
    }
    const sixth = await verifyTotp(auth, wrong, cookie);
    expect(sixth.status).toBe(400);
    expect(await sixth.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" });
    // Every wrong code is recorded; the used-up challenge checked no code
    expect(await eventCount(user.id, "two_factor_failed")).toBe(5);
  });

  it("10 wrong codes in a row lock both modes for 15 minutes", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const wrong = await wrongCode(secret);
    for (let i = 0; i < 10; i++) {
      const response = await verifyTotp(auth, wrong, cookie);
      expect([i, response.status]).toEqual([i, 401]);
    }
    const locked = await twoFactorRow(user.id);
    expect(locked.failedVerificationCount).toBe(10);
    const left = locked.lockedUntil!.getTime() - Date.now();
    expect(left).toBeGreaterThan(14 * 60 * 1000);
    expect(left).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);

    const right = await verifyTotp(auth, await totpNow(secret), cookie);
    expect(right.status).toBe(429);
    expect(await right.json()).toMatchObject({ code: "ACCOUNT_TEMPORARILY_LOCKED" });
    // A backup code meets the same lock
    const backup = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: "nope-nope" },
      { cookie },
    );
    expect(backup.status).toBe(429);

    // So does a fresh sign-in challenge
    const signIn = sessionCookie(await signInWithPassword(auth, EMAIL));
    const signInMode = await verifyTotp(auth, await totpNow(secret), signIn);
    expect(signInMode.status).toBe(429);
    expect(await signInMode.json()).toMatchObject({ code: "ACCOUNT_TEMPORARILY_LOCKED" });
    expect(await eventCount(user.id, "two_factor_failed")).toBe(10);

    await tamper(
      "update two_factors set locked_until = locked_until - interval '16 minutes' where user_id = $1",
      [user.id],
    );
    const later = await verifyTotp(auth, await totpNow(secret), cookie);
    expect(later.status).toBe(200);
    const after = await twoFactorRow(user.id);
    expect(after.failedVerificationCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("wrong codes in either mode add up to one lockout", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const wrong = await wrongCode(secret);
    // 5 at sign-in (all one challenge allows), then 5 signed in
    const signIn = sessionCookie(await signInWithPassword(auth, EMAIL));
    for (let i = 0; i < 5; i++) await verifyTotp(auth, wrong, signIn);
    const cookie = await googleSession(auth, user.id);
    for (let i = 0; i < 5; i++) await verifyTotp(auth, wrong, cookie);
    expect((await twoFactorRow(user.id)).failedVerificationCount).toBe(10);
    expect((await verifyTotp(auth, await totpNow(secret), cookie)).status).toBe(429);
  });

  it("an expired signed-in lock starts the count again", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const wrong = await wrongCode(secret);
    for (let i = 0; i < 10; i++) await verifyTotp(auth, wrong, cookie);
    await tamper(
      "update two_factors set locked_until = locked_until - interval '16 minutes' where user_id = $1",
      [user.id],
    );
    // A wrong code after the lock ran out is the first of a new run, not the 11th
    expect((await verifyTotp(auth, wrong, cookie)).status).toBe(401);
    const row = await twoFactorRow(user.id);
    expect(row.failedVerificationCount).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });

  it("a good signed-in code resets the count", async () => {
    const auth = makeAuth();
    const { user, secret } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const wrong = await wrongCode(secret);
    for (let i = 0; i < 3; i++) await verifyTotp(auth, wrong, cookie);
    expect((await twoFactorRow(user.id)).failedVerificationCount).toBe(3);
    expect((await verifyTotp(auth, await totpNow(secret), cookie)).status).toBe(200);
    expect((await twoFactorRow(user.id)).failedVerificationCount).toBe(0);
    const failed = await getDb()
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, user.id), eq(securityEvents.type, "two_factor_failed")));
    expect(failed.map((event) => event.method)).toEqual(["totp", "totp", "totp"]);
  });

  it("a wrong signed-in backup code counts and is recorded as backup_code", async () => {
    const auth = makeAuth();
    const { user } = await twoFactorUser(auth);
    const cookie = await googleSession(auth, user.id);
    const response = await post(
      auth,
      "/two-factor/verify-backup-code",
      { code: "nope-nope" },
      { cookie },
    );
    expect(response.status).toBe(401);
    expect((await twoFactorRow(user.id)).failedVerificationCount).toBe(1);
    const [event] = await getDb()
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, user.id), eq(securityEvents.type, "two_factor_failed")));
    expect(event!.method).toBe("backup_code");
  });
});

// Recording, the audit row on disable, and the password change (4.6, calls 10 and 11)
describe("kerbTwoFactor part 3 (4.6)", () => {
  beforeEach(async () => {
    await truncateAll();
    sent.length = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const NEW_PASSWORD = "a different long password";

  const eventsOf = (userId: string, type: SecurityEventType) =>
    getDb()
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, userId), eq(securityEvents.type, type)));

  it("each 2FA event writes its security_events row", async () => {
    const auth = makeAuth();
    const { user, cookie, secret } = await twoFactorUser(auth);
    const regenerate = await post(
      auth,
      "/two-factor/generate-backup-codes",
      { password: PASSWORD },
      { cookie },
    );
    expect(regenerate.status).toBe(200);
    const wrong = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret, new Date(0)) },
      { cookie },
    );
    expect(wrong.status).toBe(401);
    const disable = await post(auth, "/two-factor/disable", { password: PASSWORD }, { cookie });
    expect(disable.status).toBe(200);

    const expected = {
      two_factor_enabled: null,
      backup_codes_regenerated: null,
      two_factor_passed: "totp",
      two_factor_failed: "totp",
      two_factor_disabled: null,
    } as const;
    const all = await getDb().select().from(securityEvents);
    for (const [type, method] of Object.entries(expected)) {
      const rows = await eventsOf(user.id, type as SecurityEventType);
      expect(rows, type).toHaveLength(1);
      expect(rows[0]!.method, type).toBe(method);
    }
    for (const row of all) {
      expect(row.ipHash === null || /^[0-9a-f]{64}$/.test(row.ipHash)).toBe(true);
      expect(JSON.stringify(row).toLowerCase()).not.toContain(EMAIL);
    }
  });

  it("turning 2FA off writes two_factor.disabled and the chain verifies", async () => {
    const auth = makeAuth();
    const { user, cookie } = await twoFactorUser(auth);
    const disable = await post(auth, "/two-factor/disable", { password: PASSWORD }, { cookie });
    expect(disable.status).toBe(200);

    const rows = await getDb().select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "two_factor.disabled",
      entityType: "user",
      entityId: user.id,
      actorUserId: user.id,
      actorRole: "customer",
    });
    const result = await verifyAuditChain(getDb().$client, getAuditEnv());
    expect(result.ok).toBe(true);
  });

  it("with bad audit keys, disable is refused and 2FA stays on", async () => {
    vi.stubEnv("AUDIT_HMAC_KEYS", "garbage");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = makeAuth();
    const { user, cookie } = await twoFactorUser(auth);
    const disable = await post(auth, "/two-factor/disable", { password: PASSWORD }, { cookie });
    expect(disable.status).toBe(500);
    expect(await disable.json()).toEqual({
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    expect(row!.twoFactorEnabled).toBe(true);
    expect(
      await getDb().select().from(twoFactors).where(eq(twoFactors.userId, user.id)),
    ).toHaveLength(1);
    expect(await eventsOf(user.id, "two_factor_disabled")).toHaveLength(0);
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
  });

  it("a password change ends other sessions and keeps the user signed in and verified", async () => {
    const auth = makeAuth();
    const { user, cookie: first, secret } = await twoFactorUser(auth);
    await makeStaff({ userId: user.id });
    const signIn = await signInWithPassword(auth, EMAIL);
    const verify = await post(
      auth,
      "/two-factor/verify-totp",
      { code: await totpNow(secret) },
      { cookie: sessionCookie(signIn) },
    );
    expect(verify.status).toBe(200);
    const second = sessionCookie(verify);
    const old = await sessionsFor(user.id);
    expect(old).toHaveLength(2);
    for (const row of old) expectRecent(row.twoFactorVerifiedAt);
    const { token } = (await verify.json()) as { token: string };
    const current = old.find((row) => row.token === token)!;

    const change = await post(
      auth,
      "/change-password",
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: false },
      { cookie: second },
    );
    expect(change.status).toBe(200);

    const now = await sessionsFor(user.id);
    expect(now).toHaveLength(1);
    expect(old.map((row) => row.id)).not.toContain(now[0]!.id);
    expect(now[0]!.twoFactorVerifiedAt!.getTime()).toBe(current.twoFactorVerifiedAt!.getTime());
    expect(await eventsOf(user.id, "sessions_revoked_on_password_change")).toHaveLength(1);

    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const actor = await getActor(new Headers({ cookie: sessionCookie(change) }));
    expect(actor?.userId).toBe(user.id);
    expect(() => requirePermission(actor, "claims.read_all")).not.toThrow();
    // The revoked sessions are gone for getActor, whatever the cookie cache says
    expect(await getActor(new Headers({ cookie: first }))).toBeNull();
    expect(await getActor(new Headers({ cookie: second }))).toBeNull();
  });

  it("a reset ends all sessions and records it", async () => {
    const auth = makeAuth();
    const { user } = await signUpAndConfirm(auth);
    expect(await signInWithPassword(auth, EMAIL).then((r) => r.status)).toBe(200);
    expect(await sessionsFor(user.id)).toHaveLength(2);
    sent.length = 0;
    const request = await post(auth, "/request-password-reset", {
      email: EMAIL,
      redirectTo: "/reset-password",
    });
    expect(request.status).toBe(200);
    const token = /reset-password\/([^?\s]+)/.exec(sent[0]!.text)?.[1];
    const reset = await post(auth, "/reset-password", { newPassword: NEW_PASSWORD, token });
    expect(reset.status).toBe(200);
    expect(await sessionsFor(user.id)).toHaveLength(0);
    expect(await eventsOf(user.id, "password_reset")).toHaveLength(1);
    expect(await eventsOf(user.id, "sessions_revoked_on_password_change")).toHaveLength(1);
  });
});
