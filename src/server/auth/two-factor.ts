import { and, eq } from "drizzle-orm";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";

import type { Db } from "#/server/db/client";
import { sessions } from "#/server/db/schema";

import { resolveActor } from "./actor";
import { logSafeError } from "./errors";
import { userIdForEmail, type SecurityEventInput } from "./security-events";

// Kerb's half of two-factor (4.6, plan/phases/04-data-auth/06-two-factor.md calls 4, 5, 8 and 10).
//
// Why a plugin, registered straight after twoFactor(): Better Auth runs `hooks.before`/`hooks.after`
// from the options FIRST, then plugin hooks in plugin order (api/dispatch.mjs, getHooks). Our after
// hooks must see what twoFactor()'s own after hook on /sign-in/email has done: when a code is owed
// it deletes the half-made session and sets `newSession` to null. From `hooks.after` we'd still see
// that doomed session, record a sign_in for it, and might stamp it.
//
// The kerb2fa hand-off: what a verify request is (sign-in, setup or signed-in; whose session; staff
// or not) has to be read BEFORE the endpoint runs, because the setup code deletes the session it
// arrived with and the sign-in code consumes the two_factor cookie. A before hook may return
// `{ context: {...} }`, which dispatch merges onto the endpoint context, so our before hook returns
// `{ context: { kerb2fa } }` and our after hooks read `ctx.kerb2fa`. Request bodies live under
// `ctx.body`, so a client can't supply kerb2fa itself.

const VERIFY_TOTP = "/two-factor/verify-totp";
const VERIFY_BACKUP_CODE = "/two-factor/verify-backup-code";
const VERIFY_PATHS: ReadonlySet<string> = new Set([VERIFY_TOTP, VERIFY_BACKUP_CODE]);

/** Better Auth's signed cookie naming a pending sign-in challenge (plugins/two-factor/constant) */
const TWO_FACTOR_COOKIE = "two_factor";

/**
 * The only Better Auth endpoints a session that owes a code may reach (call 5). Everything else,
 * including any endpoint a future upgrade adds, is refused with TWO_FACTOR_CHALLENGE. Paths
 * starting `/callback/` (Google's callback) are allowed too.
 */
export const TWO_FACTOR_ALLOWLIST: readonly string[] = [
  VERIFY_TOTP,
  VERIFY_BACKUP_CODE,
  "/sign-out",
  "/get-session",
  // Google sign-in, so the user can sign in again; the proxy finishes it on preview deployments
  "/sign-in/social",
  "/oauth-proxy-callback",
];
const ALLOWED: ReadonlySet<string> = new Set(TWO_FACTOR_ALLOWLIST);

export const isAllowedWhileOwingCode = (path: string) =>
  ALLOWED.has(path) || path.startsWith("/callback/");

export const TWO_FACTOR_CHALLENGE_MESSAGE = "Enter your two-factor code to continue.";

/**
 * How a verify request proves who it is:
 * - `sign-in`: no session, so Better Auth uses the two_factor cookie and makes a new session
 * - `setup`: a session whose user has 2FA off; the confirming code replaces the session
 * - `signed-in`: everything else; the same session carries on
 */
export type TwoFactorMode = "sign-in" | "signed-in" | "setup";

/**
 * What our before hook hands our after hooks, as `ctx.kerb2fa`. Every field is optional so later
 * hooks can add their own (the /change-password stamp carry-over comes next); the verify fields
 * are set together on the two verify paths.
 */
export interface Kerb2fa {
  mode?: TwoFactorMode;
  userId?: string;
  /** The session the request arrived with; absent in sign-in mode */
  sessionId?: string;
  staff?: boolean;
}

export interface KerbTwoFactorDeps {
  db: Db;
  record: (event: SecurityEventInput) => Promise<void>;
}

/** Active staff with at least one role (a staff row with no roles left can do nothing) */
async function isStaff(db: Db, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const actor = await resolveActor(db, userId);
  return (actor?.staff?.roles.length ?? 0) > 0;
}

type HookCtx = Parameters<typeof getSessionFromCtx>[0];

/**
 * The session an endpoint will act as. First from the database, bypassing the cookie cache; the
 * endpoint reuses that lookup (ctx.context.session). When the database has none, an endpoint's own
 * lookup falls back to the cookie cache, which outlives a deleted row by up to 5 minutes (a
 * signed-out session's replayed cookies), so that copy is read and checked too. `live` says which.
 */
async function sessionFor(ctx: HookCtx) {
  const live = await getAuthoritativeSessionFromCtx(ctx);
  if (live) return { session: live, live: true };
  return { session: await getSessionFromCtx(ctx), live: false };
}

const handoff = (ctx: unknown): Kerb2fa => (ctx as { kerb2fa?: Kerb2fa }).kerb2fa ?? {};

/** A response body, not an APIError (a wrong code throws, so it arrives here as one) */
const succeeded = (returned: unknown) =>
  returned !== undefined && returned !== null && !isAPIError(returned);

export function kerbTwoFactor({ db, record }: KerbTwoFactorDeps): BetterAuthPlugin {
  /** Marks one session as having passed the second step, now (call 4) */
  async function stamp(sessionId: string, userId: string) {
    try {
      await db
        .update(sessions)
        .set({ twoFactorVerifiedAt: new Date() })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    } catch (error) {
      console.error("[auth] two-factor stamp not written:", logSafeError(error));
      // The session stays unstamped, so it's still challenged: this fails closed
      throw new APIError("INTERNAL_SERVER_ERROR", { message: "Something went wrong. Try again." });
    }
  }

  return {
    id: "kerb-two-factor",
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            if (VERIFY_PATHS.has(ctx.path)) {
              // The endpoint reuses this lookup, so its idea of signed-in matches ours
              const { session, live } = await sessionFor(ctx);
              // Only a cached copy of a deleted session: nothing to stamp, nothing to record
              if (session && !live) return;
              if (session) {
                const userId = session.user.id;
                const kerb2fa: Kerb2fa = {
                  mode: session.user.twoFactorEnabled ? "signed-in" : "setup",
                  userId,
                  sessionId: session.session.id,
                  staff: await isStaff(db, userId),
                };
                return { context: { kerb2fa } };
              }
              const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
              const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
              if (!identifier) return;
              const challenge = await ctx.context.internalAdapter.findVerificationValue(identifier);
              if (!challenge) return;
              const kerb2fa: Kerb2fa = {
                mode: "sign-in",
                userId: challenge.value,
                staff: await isStaff(db, challenge.value),
              };
              return { context: { kerb2fa } };
            }

            if (isAllowedWhileOwingCode(ctx.path)) return;
            const { session } = await sessionFor(ctx);
            if (session?.user.twoFactorEnabled && !session.session.twoFactorVerifiedAt) {
              throw new APIError("UNAUTHORIZED", {
                code: "TWO_FACTOR_CHALLENGE",
                message: TWO_FACTOR_CHALLENGE_MESSAGE,
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => VERIFY_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const { mode, userId, sessionId } = handoff(ctx);
            if (!mode || !userId || !succeeded(ctx.context.returned)) return;
            const headers = ctx.request?.headers;
            const method = ctx.path === VERIFY_TOTP ? "totp" : "backup_code";
            // The session that survives, never the returned token: in setup mode that token's
            // session has just been deleted
            const newSession = ctx.context.newSession;
            const target =
              mode === "signed-in"
                ? sessionId
                : mode === "setup"
                  ? (newSession?.session.id ?? sessionId)
                  : newSession?.session.id;
            if (target) await stamp(target, userId);
            if (mode === "sign-in") {
              // The password step recorded nothing: the code is what completes the sign-in
              await record({ type: "sign_in", userId, method: "password", headers });
            }
            await record({ type: "two_factor_passed", userId, method, headers });
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.request?.headers;
            const newSession = ctx.context.newSession;
            if (newSession) {
              const userId = newSession.user.id;
              await record({ type: "sign_in", userId, method: "password", headers });
              // twoFactor() let a 2FA user straight through, so they had a valid trusted-device
              // cookie. That counts as verified for customers, never for staff (call 8)
              if (newSession.user.twoFactorEnabled && !(await isStaff(db, userId))) {
                await stamp(newSession.session.id, userId);
              }
              return;
            }
            const returned = ctx.context.returned as { twoFactorRedirect?: unknown } | undefined;
            if (succeeded(returned) && returned?.twoFactorRedirect === true) {
              const email = (ctx.body as { email?: unknown } | undefined)?.email;
              const staff = await isStaff(db, await userIdForEmail(db, email));
              // The form shows "Trust this device" only when this is true
              return ctx.json({ ...returned, kerbTrustDevice: !staff });
            }
          }),
        },
      ],
    },
  };
}
