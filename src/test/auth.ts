import { eq } from "drizzle-orm";
import { expect } from "vite-plus/test";
import { makeSignature } from "better-auth/crypto";

import { createAuth, type AuthDeps } from "#/server/auth/auth";
import { LOCAL_URL } from "#/server/auth/origins";
import { getDb } from "#/server/db/client";
import { users } from "#/server/db/schema";
import type { EmailMessage } from "#/server/email/send";
import type { AuthEnv } from "#/server/env";

import { totpNow } from "./totp";

// Shared Better Auth helpers for integration tests (4.4, 4.6): a test auth instance, JSON posts,
// and the sign-in / 2FA / Google-session shortcuts the later slices need.

export const SECRET = "integration-secret-integration-secret-0123";
export const env: AuthEnv = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: LOCAL_URL,
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Kerb <hello@example.com>",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const PASSWORD = "correct horse battery";
export const IP = "203.0.113.7";

/** Emails the test auth instances "sent"; tests empty it with `sent.length = 0` */
export const sent: EmailMessage[] = [];

/** Work the test auth instances deferred (their emails, 4.11); `post` waits for it */
const deferred: Promise<unknown>[] = [];

/** Waits for deferred work, as Vercel finishes waitUntil work after the response */
export async function flushDeferred(): Promise<void> {
  while (deferred.length > 0) await Promise.all(deferred.splice(0));
}

export function makeAuth(overrides: Partial<AuthDeps> = {}) {
  return createAuth({
    db: getDb(),
    env,
    sendEmail: async (message) => {
      sent.push(message);
    },
    defer: (work) => {
      deferred.push(work);
    },
    captcha: false,
    breachCheck: false,
    rateLimit: false,
    ...overrides,
  });
}

export type TestAuth = ReturnType<typeof makeAuth>;

export const requestHeaders = (extra: Record<string, string> = {}) =>
  new Headers({ "x-forwarded-for": IP, "user-agent": UA, ...extra });

export async function post(auth: TestAuth, path: string, body: unknown, extra = {}) {
  const response = await auth.handler(
    new Request(`${LOCAL_URL}/api/auth${path}`, {
      method: "POST",
      headers: requestHeaders({ "content-type": "application/json", origin: LOCAL_URL, ...extra }),
      body: JSON.stringify(body),
    }),
  );
  await flushDeferred();
  return response;
}

/** The `Cookie` header value for the cookies a response set */
export function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export async function signUp(auth: TestAuth, email = "maya.patel@example.com") {
  const response = await post(auth, "/sign-up/email", {
    name: "Maya Patel",
    email,
    password: PASSWORD,
    acceptTerms: true,
    // As SignUpForm sends it
    callbackURL: "/email-confirmed",
  });
  expect(response.status).toBe(200);
  const [user] = await getDb().select().from(users).where(eq(users.email, email));
  return { user: user! };
}

/** Email and password sign-in; the caller reads the status, body and cookies */
export function signInWithPassword(auth: TestAuth, email: string) {
  return post(auth, "/sign-in/email", { email, password: PASSWORD });
}

/**
 * Turns two-factor on for the signed-in user behind `cookie`: /two-factor/enable, then
 * /two-factor/verify-totp with the code for the returned secret. Returns the new session's cookie
 * (verify-totp replaces the session), the base32 secret and the backup codes.
 */
export async function enableTwoFactor(auth: TestAuth, cookie: string) {
  const enabled = await post(auth, "/two-factor/enable", { password: PASSWORD }, { cookie });
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = new URL(totpURI).searchParams.get("secret")!;
  const verified = await post(
    auth,
    "/two-factor/verify-totp",
    { code: await totpNow(secret) },
    { cookie },
  );
  expect(verified.status).toBe(200);
  return { cookie: sessionCookie(verified), secret, backupCodes };
}

/**
 * A session for `userId` as a Google callback would leave it: a real `sessions` row made by Better
 * Auth's own adapter, and the signed cookie that goes with it. Takes the auth instance because the
 * cookie is signed with that instance's secret and named by its cookie settings.
 */
export async function googleSession(auth: TestAuth, userId: string) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const signature = await makeSignature(session.token, context.secret);
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
}
