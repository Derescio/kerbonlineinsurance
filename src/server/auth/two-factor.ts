import { and, eq, sql } from "drizzle-orm";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins/two-factor";

import type { Db } from "#/server/db/client";
import { sessions, twoFactors } from "#/server/db/schema";

import { resolveActor } from "./actor";
import { logSafeError } from "./errors";
import { userIdForEmail, type SecurityEventInput } from "./security-events";
import { LOCKOUT_AFTER, LOCKOUT_MS, PASSWORDLESS_FRESH_MS } from "./two-factor-constants";

// Kerb's half of two-factor (4.6, plan/phases/04-data-auth/06-two-factor.md calls 4, 5, 7, 8, 9
// and 10).
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
const DISABLE = "/two-factor/disable";

/**
 * The 2FA changes a user without a password makes on the strength of their session alone (call 7).
 * The plugin asks a password user for the password on each; it asks a passwordless user nothing.
 */
const PASSWORDLESS_FRESH_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/enable",
  DISABLE,
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
]);

/** The plugin's answers to a wrong code; anything else (a used-up challenge, a lock) checked none */
const WRONG_CODE: ReadonlySet<string> = new Set([
  TWO_FACTOR_ERROR_CODES.INVALID_CODE.code,
  TWO_FACTOR_ERROR_CODES.INVALID_BACKUP_CODE.code,
]);

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

/** Unexpected errors in our hooks: logged by name only, answered with a generic 500 */
const GENERIC_FAILURE = "Something went wrong. Try again.";
function failClosed(what: string, error: unknown): never {
  if (isAPIError(error)) throw error;
  console.error(`[auth] ${what} failed:`, logSafeError(error));
  throw new APIError("INTERNAL_SERVER_ERROR", { message: GENERIC_FAILURE });
}

const handoff = (ctx: unknown): Kerb2fa => (ctx as { kerb2fa?: Kerb2fa }).kerb2fa ?? {};

/** A response body, not an APIError (a wrong code throws, so it arrives here as one) */
const succeeded = (returned: unknown) =>
  returned !== undefined && returned !== null && !isAPIError(returned);

/** The plugin's 401 for a code that was checked and was wrong */
const wrongCode = (returned: unknown) =>
  isAPIError(returned) &&
  returned.statusCode === 401 &&
  WRONG_CODE.has((returned.body as { code?: string } | undefined)?.code ?? "");

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
      throw new APIError("INTERNAL_SERVER_ERROR", { message: GENERIC_FAILURE });
    }
  }

  // The signed-in lockout (call 9). The same columns, limits and lazy expiry as the plugin's
  // sign-in lockout (verify-two-factor.mjs), so wrong codes in either mode add up to one lock

  /** Refuses while the account is locked; an expired lock starts the count again, as the plugin's */
  async function assertNotLocked(userId: string) {
    const [row] = await db
      .select({
        locked: sql<boolean>`${twoFactors.lockedUntil} > now()`,
        expired: sql<boolean>`${twoFactors.lockedUntil} <= now()`,
      })
      .from(twoFactors)
      .where(eq(twoFactors.userId, userId));
    if (row?.locked) {
      throw APIError.from("TOO_MANY_REQUESTS", TWO_FACTOR_ERROR_CODES.ACCOUNT_TEMPORARILY_LOCKED);
    }
    if (row?.expired) {
      await db
        .update(twoFactors)
        .set({ failedVerificationCount: 0, lockedUntil: null })
        .where(and(eq(twoFactors.userId, userId), sql`${twoFactors.lockedUntil} <= now()`));
    }
  }

  /** One more wrong code, in one atomic statement; the tenth in a row locks the account */
  async function countFailure(userId: string) {
    const count = sql`coalesce(${twoFactors.failedVerificationCount}, 0) + 1`;
    await db
      .update(twoFactors)
      .set({
        failedVerificationCount: count,
        lockedUntil: sql`case when ${count} >= ${LOCKOUT_AFTER}
          then now() + make_interval(secs => ${LOCKOUT_MS / 1000}) end`,
      })
      .where(eq(twoFactors.userId, userId));
  }

  async function resetFailures(userId: string) {
    await db
      .update(twoFactors)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(eq(twoFactors.userId, userId));
  }

  /** An after-hook write that must not fail open or leak its error */
  async function guarded(what: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      failClosed(what, error);
    }
  }

  /** The plugin's own test for "needs the password" (utils/password.mjs, shouldRequirePassword) */
  async function hasPassword(ctx: HookCtx, userId: string) {
    const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
    return Boolean(account?.password);
  }

  return {
    id: "kerb-two-factor",
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            try {
              return await before(ctx);
            } catch (error) {
              failClosed("two-factor before hook", error);
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => VERIFY_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const { mode, userId, sessionId } = handoff(ctx);
            if (!mode || !userId) return;
            const headers = ctx.request?.headers;
            const method = ctx.path === VERIFY_TOTP ? "totp" : "backup_code";
            // The plugin counts sign-in mode's wrong codes itself and skips the others (call 9)
            const ours = mode !== "sign-in";
            if (wrongCode(ctx.context.returned)) {
              if (ours) await guarded("two-factor failure count", () => countFailure(userId));
              await record({ type: "two_factor_failed", userId, method, headers });
              return;
            }
            if (!succeeded(ctx.context.returned)) return;
            if (ours) await guarded("two-factor failure reset", () => resetFailures(userId));
            // The session that survives, never the returned token: in setup mode that token's
            // session has just been deleted. In setup and sign-in modes a code that passed
            // without making a session proves nothing, so nothing is stamped or recorded. Nor
            // does one that arrived on a cached copy of a deleted session (no sessionId)
            if (ours && !sessionId) return;
            const target = mode === "signed-in" ? sessionId : ctx.context.newSession?.session.id;
            if (!target) return;
            await stamp(target, userId);
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
              if (newSession.user.twoFactorEnabled && !(await staffOrUnknown(userId))) {
                await stamp(newSession.session.id, userId);
              }
              return;
            }
            const returned = ctx.context.returned as { twoFactorRedirect?: unknown } | undefined;
            if (succeeded(returned) && returned?.twoFactorRedirect === true) {
              const email = (ctx.body as { email?: unknown } | undefined)?.email;
              const staff = await staffOrUnknown(email, "email");
              // The form shows "Trust this device" only when this is true
              return ctx.json({ ...returned, kerbTrustDevice: !staff });
            }
          }),
        },
      ],
    },
  };

  /**
   * The /sign-in/email after hook's staff check. A failed lookup counts as staff (no stamp, no
   * tick box), so the session stays challenged and the response still goes out
   */
  async function staffOrUnknown(key: unknown, by: "id" | "email" = "id"): Promise<boolean> {
    try {
      const userId = by === "email" ? await userIdForEmail(db, key) : (key as string);
      return await isStaff(db, userId);
    } catch (error) {
      console.error("[auth] two-factor staff check failed:", logSafeError(error));
      return true;
    }
  }

  async function before(ctx: HookCtx & { path: string; body?: unknown }) {
    if (VERIFY_PATHS.has(ctx.path)) {
      // Kerb always wants the session that a passed code makes or keeps
      if ((ctx.body as { disableSession?: unknown } | undefined)?.disableSession === true) {
        throw new APIError("BAD_REQUEST", {
          code: "DISABLE_SESSION_NOT_ALLOWED",
          message: "This request isn't allowed.",
        });
      }
      // The endpoint reuses this lookup, so its idea of signed-in matches ours
      const { session, live } = await sessionFor(ctx);
      if (session) {
        const userId = session.user.id;
        const mode: TwoFactorMode = session.user.twoFactorEnabled ? "signed-in" : "setup";
        // Setup is confirmed with the app's code. Better Auth would accept a backup code
        // from the unconfirmed enrolment without turning 2FA on
        if (mode === "setup" && ctx.path === VERIFY_BACKUP_CODE) {
          throw new APIError("BAD_REQUEST", {
            code: "TWO_FACTOR_NOT_ENABLED",
            message: "Two-factor isn't on yet. Enter the code from your authenticator app.",
          });
        }
        // The plugin skips its lockout when there's a session, so ours applies (call 9)
        await assertNotLocked(userId);
        return verifying(ctx, {
          mode,
          userId,
          // Only a cached copy of a deleted session: still counted, but nothing to stamp
          sessionId: live ? session.session.id : undefined,
          staff: await isStaff(db, userId),
        });
      }
      const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
      const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
      if (!identifier) return;
      const challenge = await ctx.context.internalAdapter.findVerificationValue(identifier);
      if (!challenge) return;
      return verifying(ctx, {
        mode: "sign-in",
        userId: challenge.value,
        staff: await isStaff(db, challenge.value),
      });
    }

    if (isAllowedWhileOwingCode(ctx.path)) return;
    const { session } = await sessionFor(ctx);
    if (!session) return;
    if (session.user.twoFactorEnabled && !session.session.twoFactorVerifiedAt) {
      throw new APIError("UNAUTHORIZED", {
        code: "TWO_FACTOR_CHALLENGE",
        message: TWO_FACTOR_CHALLENGE_MESSAGE,
      });
    }
    const userId = session.user.id;
    // Staff can't turn two-factor off (call 8)
    if (ctx.path === DISABLE && (await isStaff(db, userId))) {
      throw new APIError("FORBIDDEN", {
        code: "TWO_FACTOR_REQUIRED",
        message: "Staff accounts need two-factor. Set it up to continue.",
      });
    }
    // Without a password, a recent sign-in is the proof (call 7)
    if (PASSWORDLESS_FRESH_PATHS.has(ctx.path) && !(await hasPassword(ctx, userId))) {
      const age = Date.now() - new Date(session.session.createdAt).getTime();
      // Written so an unreadable createdAt (NaN) fails closed
      if (!(age <= PASSWORDLESS_FRESH_MS)) {
        throw new APIError("FORBIDDEN", {
          code: "SESSION_NOT_FRESH",
          message: "Confirm it's you to continue.",
        });
      }
    }
  }

  /**
   * The verify hand-off. A staff member's `trustDevice` is turned off here, in the body the
   * endpoint reads (dispatch merges `context.body` over the request's), so the plugin never sets
   * the trust cookie or its trust-device-* row (call 8). `false`, not removed: the merge skips
   * undefined
   */
  function verifying(ctx: { body?: unknown }, kerb2fa: Kerb2fa) {
    const body = ctx.body as Record<string, unknown> | undefined;
    if (kerb2fa.staff && body && body.trustDevice !== undefined) {
      return { context: { kerb2fa, body: { ...body, trustDevice: false } } };
    }
    return { context: { kerb2fa } };
  }
}
