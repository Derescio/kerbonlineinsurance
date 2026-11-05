import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { captcha } from "better-auth/plugins/captcha";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { twoFactor } from "better-auth/plugins/two-factor";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { PASSWORD_MAX, PASSWORD_MIN } from "#/features/auth/schemas";
import { getDb, type Db } from "#/server/db/client";
import { resendSender, type SendEmail } from "#/server/email/send";
import { resetPasswordEmail, verifyEmail } from "#/server/email/templates";
import { getAuthEnv, type AuthEnv } from "#/server/env";

import { breachedPasswordCheck } from "./breached-password";
import {
  ACCOUNT_EXISTS_CODE,
  ACCOUNT_EXISTS_MESSAGE,
  decideGoogleLink,
  GOOGLE,
  removeUnverifiedPassword,
} from "./linking";
import { authUrls } from "./origins";
import { recordSecurityEvent, userIdForEmail, type SecurityEventInput } from "./security-events";

// Better Auth (4.4, plan/phases/04-data-auth/04-better-auth.md; plan/engineering.md section 7).
// Built on first use (getAuth), not at import, so nothing connects to the database or reads the
// auth environment until a request needs it. Tests build their own with createAuth().

export const TERMS_REQUIRED_MESSAGE = "Tick to agree to the terms of use.";

const DAY = 24 * 60 * 60;

export interface AuthDeps {
  db: Db;
  env: AuthEnv;
  sendEmail: SendEmail;
  /** Keeps work alive after the response (Vercel's waitUntil); tests await it themselves */
  defer?: (work: Promise<unknown>) => void;
  /** Turnstile on sign-up and reset (decision 3). Off in tests */
  captcha?: boolean;
  /** Have I Been Pwned (engineering.md section 7). Off in tests unless a fetch is given */
  breachCheck?: boolean | { fetchFn: (url: string, init: RequestInit) => Promise<Response> };
  /** Better Auth's limiter (decision 4). Off in tests unless they check it */
  rateLimit?: boolean;
}

export function createAuth(deps: AuthDeps) {
  const { db, env } = deps;
  const urls = authUrls(env);
  const secret = env.BETTER_AUTH_SECRET;
  const record = (event: SecurityEventInput) => recordSecurityEvent(db, secret, event);

  // Emails go after the response: awaiting the send would make "this email has an account"
  // visible from how long the request takes. A failed send is logged, never shown as an error.
  const deliver = (to: string, content: { subject: string; html: string; text: string }) => {
    const work = deps.sendEmail({ to, ...content }).catch((error: unknown) => {
      console.error("[auth] email not sent:", (error as Error).message);
    });
    if (deps.defer) deps.defer(work);
  };

  const breach = deps.breachCheck ?? true;

  return betterAuth({
    appName: "Kerb",
    baseURL: urls.baseURL,
    secret,
    trustedOrigins: urls.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true }),

    user: {
      additionalFields: {
        // Seeded demo data (4.9); every synthetic row hangs off a synthetic user (4.2, decision 10)
        isSynthetic: { type: "boolean", required: false, defaultValue: false, input: false },
        // Set by the server when the sign-up form's terms box was ticked (decision 5)
        termsAcceptedAt: { type: "date", required: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      // Soft verification: a banner, not a blocker (engineering.md section 7)
      requireEmailVerification: false,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      // One hour, as frame 06b says
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        deliver(user.email, resetPasswordEmail({ name: user.name, url }));
      },
      onPasswordReset: async ({ user }, request) => {
        await record({ type: "password_reset", userId: user.id, headers: request?.headers });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // 24 hours, as frame 07d says
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        deliver(user.email, verifyEmail({ name: user.name, url }));
      },
      afterEmailVerification: async (user, request) => {
        await record({ type: "email_verified", userId: user.id, headers: request?.headers });
      },
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        // Google isn't trusted: an email Google hasn't verified never links (decision 2)
        trustedProviders: [],
        // Better Auth's default refuses to link to an unverified Kerb account; decision 2 links
        // it and removes the unproven password instead (databaseHooks below)
        requireLocalEmailVerified: false,
      },
    },

    session: {
      expiresIn: 7 * DAY,
      // Sliding: refreshed at most once a day of use
      updateAge: DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    rateLimit: {
      enabled: deps.rateLimit ?? true,
      storage: "database",
      modelName: "authRateLimit",
      window: 60,
      max: 100,
      // decision 4: 15-minute windows, matching frame 02b's "Wait 15 minutes"
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/sign-up/email": { window: 15 * 60, max: 5 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/send-verification-email": { window: 15 * 60, max: 3 },
      },
    },

    advanced: {
      // Vercel's own header first: the client can't set it
      ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"] },
      useSecureCookies: urls.baseURL.startsWith("https://"),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            // The terms box was checked in hooks.before; record when (decision 5)
            if (ctx?.path === "/sign-up/email") {
              return { data: { ...user, termsAcceptedAt: new Date() } };
            }
          },
          after: async (user, ctx) => {
            const method = ctx?.path?.startsWith("/callback") ? "google" : "password";
            await record({
              type: "sign_up",
              userId: user.id,
              method,
              headers: ctx?.request?.headers,
            });
          },
        },
      },
      account: {
        create: {
          before: async (account, ctx) => {
            if (account.providerId !== GOOGLE || !ctx) return;
            const session = await getSessionFromCtx(ctx).catch(() => null);
            const decision = await decideGoogleLink(db, {
              userId: account.userId,
              signedInUserId: session?.user.id ?? null,
            });
            if (decision === "refuse") {
              await record({
                type: "google_link_refused",
                userId: account.userId,
                method: "google",
                headers: ctx.request?.headers,
              });
              throw new APIError("FORBIDDEN", {
                code: ACCOUNT_EXISTS_CODE,
                message: ACCOUNT_EXISTS_MESSAGE,
              });
            }
          },
          after: async (account, ctx) => {
            if (account.providerId !== GOOGLE || !ctx) return;
            const session = await getSessionFromCtx(ctx).catch(() => null);
            const decision = await decideGoogleLink(db, {
              userId: account.userId,
              signedInUserId: session?.user.id ?? null,
            });
            const headers = ctx.request?.headers;
            if (decision === "explicit") {
              await record({
                type: "google_linked",
                userId: account.userId,
                method: "google",
                headers,
              });
            } else if (decision === "replace-unverified") {
              await removeUnverifiedPassword(db, account.userId);
              await record({
                type: "password_removed_on_link",
                userId: account.userId,
                method: "google",
                headers,
              });
            }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          if ((ctx.body as Record<string, unknown> | undefined)?.acceptTerms !== true) {
            throw new APIError("BAD_REQUEST", {
              code: "TERMS_REQUIRED",
              message: TERMS_REQUIRED_MESSAGE,
            });
          }
        }
        if (ctx.path === "/sign-out") {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session) {
            await record({
              type: "sign_out",
              userId: session.user.id,
              headers: ctx.request?.headers,
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const headers = ctx.request?.headers;
        const body = ctx.body as Record<string, unknown> | undefined;
        if (ctx.path === "/sign-in/email") {
          const session = ctx.context.newSession;
          if (session) {
            await record({ type: "sign_in", userId: session.user.id, method: "password", headers });
          } else if (ctx.context.returned instanceof APIError) {
            // No email stored: the user id if the address is known, otherwise nothing
            const userId = await userIdForEmail(db, body?.email);
            await record({ type: "sign_in_failed", userId, method: "password", headers });
          }
        }
        if (ctx.path.startsWith("/callback/") && ctx.context.newSession) {
          await record({
            type: "sign_in",
            userId: ctx.context.newSession.user.id,
            method: "google",
            headers,
          });
        }
        if (ctx.path === "/request-password-reset") {
          const userId = await userIdForEmail(db, body?.email);
          if (userId) await record({ type: "password_reset_requested", userId, headers });
        }
      }),
    },

    plugins: [
      twoFactor({ issuer: "Kerb" }),
      ...(breach
        ? [breachedPasswordCheck(typeof breach === "object" ? { fetchFn: breach.fetchFn } : {})]
        : []),
      ...(deps.captcha === false
        ? []
        : [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: env.TURNSTILE_SECRET_KEY,
              endpoints: ["/sign-up/email", "/request-password-reset"],
            }),
          ]),
      ...(urls.oauthProxy && env.OAUTH_PROXY_SECRET
        ? [oAuthProxy({ ...urls.oauthProxy, secret: env.OAUTH_PROXY_SECRET })]
        : []),
      // Last, so cookies set by server-side auth.api calls reach TanStack Start's response
      tanstackStartCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

export function getAuth(): Auth {
  if (auth) return auth;
  const env = getAuthEnv();
  auth = createAuth({
    db: getDb(),
    env,
    sendEmail: resendSender(env.RESEND_API_KEY, env.EMAIL_FROM),
    defer: waitUntil,
  });
  return auth;
}
