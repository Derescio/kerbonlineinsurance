import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { accounts, securityEvents, sessions, twoFactors, users } from "#/server/db/schema";
import type { EmailMessage } from "#/server/email/send";
import type { AuthEnv } from "#/server/env";
import { truncateAll } from "#/test/db";

import { createAuth, type AuthDeps } from "./auth";
import { BREACHED_PASSWORD_MESSAGE } from "./breached-password";
import { handleAuthRequest } from "./handler";
import { decideGoogleLink, removeUnverifiedPassword } from "./linking";
import { LOCAL_URL } from "./origins";
import { recordSecurityEvent } from "./security-events";

// Better Auth against the test database (4.4; the 4.2 review asked for sign up → sign in → 2FA,
// since 4.2 changed the generated tables to timestamptz and NOT NULL booleans).

const SECRET = "integration-secret-integration-secret-0123";
const env: AuthEnv = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: LOCAL_URL,
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Kerb <hello@example.com>",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const PASSWORD = "correct horse battery";
const IP = "203.0.113.7";

let sent: EmailMessage[] = [];

function makeAuth(overrides: Partial<AuthDeps> = {}) {
  return createAuth({
    db: getDb(),
    env,
    sendEmail: async (message) => {
      sent.push(message);
    },
    captcha: false,
    breachCheck: false,
    rateLimit: false,
    ...overrides,
  });
}

const requestHeaders = (extra: Record<string, string> = {}) =>
  new Headers({ "x-forwarded-for": IP, "user-agent": UA, ...extra });

async function post(auth: ReturnType<typeof makeAuth>, path: string, body: unknown, extra = {}) {
  return auth.handler(
    new Request(`${LOCAL_URL}/api/auth${path}`, {
      method: "POST",
      headers: requestHeaders({ "content-type": "application/json", origin: LOCAL_URL, ...extra }),
      body: JSON.stringify(body),
    }),
  );
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function signUp(auth: ReturnType<typeof makeAuth>, email = "maya.patel@example.com") {
  const response = await post(auth, "/sign-up/email", {
    name: "Maya Patel",
    email,
    password: PASSWORD,
    acceptTerms: true,
  });
  expect(response.status).toBe(200);
  const [user] = await getDb().select().from(users).where(eq(users.email, email));
  return { user: user!, cookie: sessionCookie(response) };
}

const events = () => getDb().select().from(securityEvents).orderBy(securityEvents.createdAt);

describe("Better Auth (4.4)", () => {
  beforeEach(async () => {
    await truncateAll();
    sent = [];
  });
  afterAll(closeDb);

  describe("sign up", () => {
    it("creates the user, records the terms and sends the verification email", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      expect(user.emailVerified).toBe(false);
      expect(user.termsAcceptedAt).toBeInstanceOf(Date);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe("maya.patel@example.com");
      expect(sent[0]!.subject).toBe("Confirm your email for Kerb");
      expect(sent[0]!.text).toContain(`${LOCAL_URL}/api/auth/verify-email?token=`);
    });

    it("refuses a sign-up without the terms box", async () => {
      const response = await post(makeAuth(), "/sign-up/email", {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        password: PASSWORD,
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("TERMS_REQUIRED");
      expect(await getDb().select().from(users)).toHaveLength(0);
    });

    it("refuses a password under 10 characters", async () => {
      const response = await post(makeAuth(), "/sign-up/email", {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        password: "123456789",
        acceptTerms: true,
      });
      expect(response.status).toBe(400);
    });

    it("refuses a breached password with the 4.3 message", async () => {
      // SHA-1("correct horse battery") suffix, reported as breached by the mocked range API
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(PASSWORD));
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      const fetchFn = vi.fn(async () => new Response(`${hash.slice(5)}:42`));
      const response = await post(makeAuth({ breachCheck: { fetchFn } }), "/sign-up/email", {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        password: PASSWORD,
        acceptTerms: true,
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { message: string }).message).toBe(
        BREACHED_PASSWORD_MESSAGE,
      );
    });
  });

  describe("sign in, 2FA and security events", () => {
    it("signs up, signs in and turns on 2FA against the generated tables", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      const signIn = await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: PASSWORD,
      });
      expect(signIn.status).toBe(200);
      const enable = await post(
        auth,
        "/two-factor/enable",
        { password: PASSWORD },
        { cookie: sessionCookie(signIn) },
      );
      expect(enable.status).toBe(200);
      const body = (await enable.json()) as { totpURI: string; backupCodes: string[] };
      expect(body.totpURI).toMatch(/^otpauth:\/\/totp\/Kerb:/);
      expect(body.backupCodes).toHaveLength(10);
      const [enrolment] = await getDb()
        .select()
        .from(twoFactors)
        .where(eq(twoFactors.userId, user.id));
      // Stored encrypted, never as the plain base32 secret
      expect(enrolment?.secret).toBeTruthy();
      expect(body.totpURI).not.toContain(enrolment!.secret);
    });

    it("writes one event each for sign-up, sign-in and a failed sign-in, with a hashed IP and no email", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      await post(auth, "/sign-in/email", { email: "maya.patel@example.com", password: PASSWORD });
      await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: "wrong one!!",
      });
      await post(auth, "/sign-in/email", { email: "nobody@example.com", password: "wrong one!!" });

      const rows = await events();
      expect(rows.map(({ type, userId, method }) => [type, userId, method])).toEqual([
        ["sign_up", user.id, "password"],
        ["sign_in", user.id, "password"],
        ["sign_in_failed", user.id, "password"],
        ["sign_in_failed", null, "password"],
      ]);
      for (const row of rows) {
        expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.userAgentSummary).toBe("Chrome on Windows");
        expect(JSON.stringify(row)).not.toContain("example.com");
        expect(JSON.stringify(row)).not.toContain(IP);
      }
    });

    it("records a sign-out", async () => {
      const auth = makeAuth();
      const { user, cookie } = await signUp(auth);
      await post(auth, "/sign-out", {}, { cookie });
      expect((await events()).at(-1)).toMatchObject({ type: "sign_out", userId: user.id });
    });
  });

  describe("password reset", () => {
    it("emails a one-hour link, resets, signs out every session and records both steps", async () => {
      const auth = makeAuth();
      await signUp(auth);
      await post(auth, "/sign-in/email", { email: "maya.patel@example.com", password: PASSWORD });
      expect(await getDb().select().from(sessions)).toHaveLength(2);

      sent = [];
      const request = await post(auth, "/request-password-reset", {
        email: "maya.patel@example.com",
        redirectTo: "/reset-password",
      });
      expect(request.status).toBe(200);
      expect(sent[0]!.subject).toBe("Reset your Kerb password");
      const token = /reset-password\/([^?\s]+)/.exec(sent[0]!.text)?.[1];
      expect(token).toBeTruthy();

      const reset = await post(auth, "/reset-password", {
        newPassword: "a brand new password",
        token,
      });
      expect(reset.status).toBe(200);
      expect(await getDb().select().from(sessions)).toHaveLength(0);
      const types = (await events()).map(({ type }) => type);
      expect(types).toEqual(expect.arrayContaining(["password_reset_requested", "password_reset"]));
    });

    it("says nothing about an unknown address, and records nothing", async () => {
      const response = await post(makeAuth(), "/request-password-reset", {
        email: "nobody@example.com",
        redirectTo: "/reset-password",
      });
      expect(response.status).toBe(200);
      expect(sent).toHaveLength(0);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("rate limit (decision 4)", () => {
    it("allows 10 sign-in attempts in 15 minutes, then answers 429 and records it", async () => {
      const auth = makeAuth({ rateLimit: true });
      const attempt = () =>
        handleAuthRequest(
          auth,
          new Request(`${LOCAL_URL}/api/auth/sign-in/email`, {
            method: "POST",
            headers: requestHeaders({ "content-type": "application/json", origin: LOCAL_URL }),
            body: JSON.stringify({ email: "nobody@example.com", password: "wrong one!!" }),
          }),
          (headers) => recordSecurityEvent(getDb(), SECRET, { type: "rate_limited", headers }),
        );
      for (let i = 0; i < 10; i++) expect((await attempt()).status).not.toBe(429);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("cache-control")).toBe("private, no-store");
      expect((await events()).filter(({ type }) => type === "rate_limited")).toHaveLength(1);
    });
  });

  describe("Google and existing accounts (decision 2)", () => {
    it("a first sign-in with Google is a new user", async () => {
      const [user] = await getDb()
        .insert(users)
        .values({ id: "u-google", name: "G User", email: "g@example.com", emailVerified: true })
        .returning();
      expect(await decideGoogleLink(getDb(), { userId: user!.id, signedInUserId: null })).toBe(
        "new-user",
      );
    });

    it("links to an unverified account and removes its password and sessions", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      expect(await decideGoogleLink(getDb(), { userId: user.id, signedInUserId: null })).toBe(
        "replace-unverified",
      );
      await removeUnverifiedPassword(getDb(), user.id);
      const left = await getDb().select().from(accounts).where(eq(accounts.userId, user.id));
      expect(left.filter(({ providerId }) => providerId === "credential")).toHaveLength(0);
      expect(
        await getDb().select().from(sessions).where(eq(sessions.userId, user.id)),
      ).toHaveLength(0);
    });

    it("refuses to merge into an account whose email is verified", async () => {
      const { user } = await signUp(makeAuth());
      await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
      expect(await decideGoogleLink(getDb(), { userId: user.id, signedInUserId: null })).toBe(
        "refuse",
      );
    });

    it("allows Connect Google from a session signed in as that user", async () => {
      const { user } = await signUp(makeAuth());
      await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
      expect(await decideGoogleLink(getDb(), { userId: user.id, signedInUserId: user.id })).toBe(
        "explicit",
      );
    });

    it("a different signed-in user doesn't count as explicit", async () => {
      const { user } = await signUp(makeAuth());
      await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
      expect(
        await decideGoogleLink(getDb(), { userId: user.id, signedInUserId: "someone-else" }),
      ).toBe("refuse");
    });
  });

  describe("security_events table", () => {
    it("refuses a direct update, and goes with its user", async () => {
      const { user } = await signUp(makeAuth());
      await expect(
        getDb().execute(sql`update security_events set type = 'sign_in'`),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
      await getDb().delete(users).where(eq(users.id, user.id));
      expect(await events()).toHaveLength(0);
    });
  });
});
