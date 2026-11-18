import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { COOKIES } from "#/features/legal/cookies";
import { closeDb, getDb } from "#/server/db/client";
import { accounts, jobs, securityEvents, sessions, twoFactors, users } from "#/server/db/schema";
import {
  enableTwoFactor,
  googleSession,
  IP,
  makeAuth,
  PASSWORD,
  post,
  requestHeaders,
  SECRET,
  sent,
  sessionCookie,
  signInWithPassword,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";
import { totpNow } from "#/test/totp";

import { BREACHED_PASSWORD_MESSAGE } from "./breached-password";
import { handleAuthRequest } from "./handler";
import { decideGoogleLink, removeUnverifiedPassword } from "./linking";
import { LOCAL_URL } from "./origins";
import { recordSecurityEvent } from "./security-events";

// Better Auth against the test database (4.4; the 4.2 review asked for sign up → sign in → 2FA,
// since 4.2 changed the generated tables to timestamptz and NOT NULL booleans).

/** Opens the latest verification link sent to an address; returns the redirect and the session */
async function openVerificationLink(auth: TestAuth, email: string) {
  const message = sent
    .filter((mail) => mail.to === email && mail.subject === "Confirm your email for Kerb")
    .at(-1);
  const url = /(http\S+verify-email\?token=\S+)/.exec(message!.text)![1]!;
  const response = await auth.handler(new Request(url, { headers: requestHeaders() }));
  return { location: response.headers.get("location"), cookie: sessionCookie(response) };
}

/** Sign up and confirm (4.4b): the only way an email-and-password user gets a session */
async function signUpAndConfirm(auth: TestAuth, email = "maya.patel@example.com") {
  const { user } = await signUp(auth, email);
  const { cookie } = await openVerificationLink(auth, email);
  return { user, cookie };
}

const events = () => getDb().select().from(securityEvents).orderBy(securityEvents.createdAt);

describe("Better Auth (4.4)", () => {
  beforeEach(async () => {
    await truncateAll();
    sent.length = 0;
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
      expect(sent[0]!.text).toContain("The link works for 6 hours.");
      // Sent as an email job (4.11): done, its address and link cleared from the payload
      expect(await getDb().select().from(jobs)).toEqual([
        expect.objectContaining({
          type: "email.send",
          status: "done",
          payload: {},
          lastError: null,
        }),
      ]);
    });

    it("doesn't sign the new user in (4.4b)", async () => {
      const response = await post(makeAuth(), "/sign-up/email", {
        name: "Maya Patel",
        email: "maya.patel@example.com",
        password: PASSWORD,
        acceptTerms: true,
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { token: string | null }).token).toBeNull();
      expect(await getDb().select().from(sessions)).toHaveLength(0);
    });

    it("answers a sign-up for an existing email like a new one, and tells the owner (4.4b)", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      sent.length = 0;
      const again = await post(auth, "/sign-up/email", {
        name: "Someone Else",
        email: "maya.patel@example.com",
        password: "another long password",
        acceptTerms: true,
      });
      expect(again.status).toBe(200);
      const body = (await again.json()) as { token: string | null; user: { id: string } };
      expect(body.token).toBeNull();
      expect(body.user.id).not.toBe(user.id);
      expect(await getDb().select().from(users)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe("maya.patel@example.com");
      expect(sent[0]!.subject).toBe("Someone tried to make a Kerb account with your email");
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
      const { user } = await signUpAndConfirm(auth);
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
      const { user } = await signUpAndConfirm(auth);
      await post(auth, "/sign-in/email", { email: "maya.patel@example.com", password: PASSWORD });
      await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: "wrong one!!",
      });
      await post(auth, "/sign-in/email", { email: "nobody@example.com", password: "wrong one!!" });

      const rows = await events();
      expect(rows.map(({ type, userId, method }) => [type, userId, method])).toEqual([
        ["sign_up", user.id, "password"],
        ["email_verified", user.id, null],
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
      const { user, cookie } = await signUpAndConfirm(auth);
      await post(auth, "/sign-out", {}, { cookie });
      expect((await events()).at(-1)).toMatchObject({ type: "sign_out", userId: user.id });
    });
  });

  describe("email verification (4.4b)", () => {
    it("refuses to log in before the email is confirmed, records it and sends nothing", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      sent.length = 0;
      const signIn = await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: PASSWORD,
      });
      expect(signIn.status).toBe(403);
      expect(((await signIn.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
      expect(await getDb().select().from(sessions)).toHaveLength(0);
      // No sendOnSignIn: resends go through the 3-per-15-minutes endpoint instead
      expect(sent).toHaveLength(0);
      expect((await events()).at(-1)).toMatchObject({
        type: "sign_in_unverified",
        userId: user.id,
        method: "password",
      });
    });

    it("a wrong password on an unconfirmed account is still just a failed sign-in", async () => {
      const auth = makeAuth();
      await signUp(auth);
      const signIn = await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: "wrong one!!",
      });
      expect(signIn.status).toBe(401);
      expect((await events()).at(-1)).toMatchObject({ type: "sign_in_failed" });
    });

    it("the link signs the user in, and after that logging in works", async () => {
      const auth = makeAuth();
      await signUp(auth);
      const { location, cookie } = await openVerificationLink(auth, "maya.patel@example.com");
      expect(location).toBe("/email-confirmed");
      expect(cookie).toContain("session_token");
      const signIn = await post(auth, "/sign-in/email", {
        email: "maya.patel@example.com",
        password: PASSWORD,
      });
      expect(signIn.status).toBe(200);
    });

    describe("the link lasts 6 hours", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        [5 * 60 + 59, "/email-confirmed"],
        [6 * 60 + 1, "/email-confirmed?error=TOKEN_EXPIRED"],
      ])("opened after %i minutes", async (minutes, expected) => {
        const auth = makeAuth();
        await signUp(auth);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + minutes * 60 * 1000);
        const { location } = await openVerificationLink(auth, "maya.patel@example.com");
        expect(location).toBe(expected);
      });
    });

    it("a resend without a session gives the same answer for any address", async () => {
      const auth = makeAuth();
      await signUp(auth);
      sent.length = 0;
      for (const email of ["maya.patel@example.com", "nobody@example.com"]) {
        const response = await post(auth, "/send-verification-email", {
          email,
          callbackURL: "/email-confirmed",
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: true });
      }
      expect(sent.map(({ to }) => to)).toEqual(["maya.patel@example.com"]);
    });
  });

  describe("email jobs (4.11)", () => {
    const HOUR = 60 * 60_000;
    const down = () =>
      makeAuth({
        sendEmail: async () => {
          throw new Error("Resend is down");
        },
      });
    /** The newest email job, left failed by the sender above, so its payload is still there */
    const newestJob = async () => {
      const rows = await getDb().select().from(jobs).orderBy(jobs.id);
      const job = rows.at(-1)!;
      expect(job).toMatchObject({ type: "email.send", status: "failed" });
      return job.payload as { template: string; expiresAt: string };
    };
    const hoursLeft = (expiresAt: string) => (new Date(expiresAt).getTime() - Date.now()) / HOUR;

    it("a verification email carries its template and a link that lasts 6 hours", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await signUp(down());
      const payload = await newestJob();
      expect(payload.template).toBe("verify_email");
      expect(hoursLeft(payload.expiresAt)).toBeGreaterThan(5.9);
      expect(hoursLeft(payload.expiresAt)).toBeLessThanOrEqual(6);
    });

    it("a reset email carries its template and a link that lasts 1 hour", async () => {
      await signUpAndConfirm(makeAuth());
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await post(down(), "/request-password-reset", {
        email: "maya.patel@example.com",
        redirectTo: "/reset-password",
      });
      expect(response.status).toBe(200);
      const payload = await newestJob();
      expect(payload.template).toBe("reset_password");
      expect(hoursLeft(payload.expiresAt)).toBeGreaterThan(0.9);
      expect(hoursLeft(payload.expiresAt)).toBeLessThanOrEqual(1);
    });
  });

  describe("password reset", () => {
    it("emails a one-hour link, resets, signs out every session and records both steps", async () => {
      const auth = makeAuth();
      await signUpAndConfirm(auth);
      await post(auth, "/sign-in/email", { email: "maya.patel@example.com", password: PASSWORD });
      expect(await getDb().select().from(sessions)).toHaveLength(2);

      sent.length = 0;
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

    it("the verify rate limit refuses the 11th try (4.6)", async () => {
      const auth = makeAuth({ rateLimit: true });
      const verify = (path: string) => post(auth, path, { code: "000000" });
      for (let i = 0; i < 10; i++) {
        expect((await verify("/two-factor/verify-totp")).status).not.toBe(429);
      }
      expect((await verify("/two-factor/verify-totp")).status).toBe(429);
      // Counted per path: the backup-code path from the same IP still answers
      expect((await verify("/two-factor/verify-backup-code")).status).not.toBe(429);
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

  describe("two-factor and sessions (4.6)", () => {
    it("the browser can't set two_factor_verified_at", async () => {
      const auth = makeAuth();
      const { user, cookie } = await signUpAndConfirm(auth);
      const response = await post(
        auth,
        "/update-session",
        { twoFactorVerifiedAt: new Date().toISOString() },
        { cookie },
      );
      // The endpoint exists and is reached with a valid session: it refuses with this exact message
      // because input: false forbids the field (with input: true it answers 200)
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        message: "twoFactorVerifiedAt is not allowed to be set",
      });
      const rows = await getOwnerDb().select().from(sessions).where(eq(sessions.userId, user.id));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.twoFactorVerifiedAt).toBeNull();
    });

    it("enableTwoFactor turns two-factor on and returns a working session", async () => {
      const auth = makeAuth();
      const { user, cookie } = await signUpAndConfirm(auth);
      const enabled = await enableTwoFactor(auth, cookie);
      expect(enabled.backupCodes.length).toBeGreaterThan(0);
      const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
      expect(row!.twoFactorEnabled).toBe(true);
      const session = await auth.handler(
        new Request(`${LOCAL_URL}/api/auth/get-session`, {
          headers: requestHeaders({ cookie: enabled.cookie }),
        }),
      );
      expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id);
    });

    it("a password sign-in after enableTwoFactor asks for the second step", async () => {
      const auth = makeAuth();
      const { cookie } = await signUpAndConfirm(auth);
      await enableTwoFactor(auth, cookie);
      const response = await signInWithPassword(auth, "maya.patel@example.com");
      expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
    });

    it("googleSession's cookie is a real signed session for that user", async () => {
      const auth = makeAuth();
      const { user } = await signUp(auth);
      const cookie = await googleSession(auth, user.id);
      expect(await getDb().select().from(sessions)).toHaveLength(1);
      const response = await auth.handler(
        new Request(`${LOCAL_URL}/api/auth/get-session`, { headers: requestHeaders({ cookie }) }),
      );
      expect(((await response.json()) as { user: { id: string } }).user.id).toBe(user.id);
    });
  });

  describe("cookies named on /cookies (4.7)", () => {
    it("every Set-Cookie name the auth flow issues has a COOKIES entry", async () => {
      const auth = makeAuth();
      const names = new Set<string>();
      const collect = (response: Response) => {
        for (const line of response.headers.getSetCookie()) {
          names.add(line.split("=")[0]!.replace(/^__Secure-/, ""));
        }
        return response;
      };

      const { cookie } = await signUpAndConfirm(auth);
      const enabled = await enableTwoFactor(auth, cookie);
      // A password sign-in that owes a code (two_factor), then the code with "trust this device"
      const challenge = collect(await signInWithPassword(auth, "maya.patel@example.com"));
      const verify = collect(
        await post(
          auth,
          "/two-factor/verify-totp",
          { code: await totpNow(enabled.secret), trustDevice: true },
          { cookie: sessionCookie(challenge) },
        ),
      );
      // Reading the session back refreshes the cache cookie
      collect(
        await auth.handler(
          new Request(`${LOCAL_URL}/api/auth/get-session`, {
            headers: requestHeaders({ cookie: sessionCookie(verify) }),
          }),
        ),
      );
      // "Remember me" unticked
      collect(
        await post(auth, "/sign-in/email", {
          email: "maya.patel@example.com",
          password: PASSWORD,
          rememberMe: false,
        }),
      );
      collect(await post(auth, "/sign-out", {}, { cookie: sessionCookie(verify) }));

      expect([...names].sort()).toContain("better-auth.session_token");
      const listed = COOKIES.map((entry) => entry.name);
      for (const name of names) expect(listed, name).toContain(name);
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
