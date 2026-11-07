import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { normaliseBackupCode } from "#/features/auth/two-factor/codes";
import { getAuth, type Auth } from "#/server/auth/auth";
import type { Actor } from "#/server/auth/actor";
import { PASSWORDLESS_FRESH_MS } from "#/server/auth/two-factor-constants";
import { rejected, type Rejected } from "#/lib/validation";

// Proof before an irreversible account action (4.7 call 12): the password if there is one (else a
// recent Google sign-in), and a 2FA code if two-factor is on. Better Auth does the checking, so
// its hooks count wrong codes against the one shared lockout (two-factor.ts).

export const confirmInput = z.object({
  password: z.string().optional(),
  code: z.string().optional(),
});

export type ConfirmInput = z.infer<typeof confirmInput>;

const WRONG_PASSWORD = "That password isn't right.";
const WRONG_CODE = "That code isn't right.";
const LOCKED = "Too many wrong codes. Try again in 15 minutes.";
const GOOGLE_AGAIN = "Sign in with Google again to confirm it's you.";

const TOTP_SHAPE = /^\d{6}$/;

/** null means proven; otherwise the rejection to hand back to the form */
export async function confirmIdentity(
  actor: Actor,
  input: ConfirmInput,
  headers: Headers,
  auth: Auth = getAuth(),
): Promise<Rejected | null> {
  const accounts = await auth.api.listUserAccounts({ headers });
  const hasPassword = accounts.some((account) => account.providerId === "credential");

  if (hasPassword) {
    if (!input.password) return rejected(WRONG_PASSWORD, { password: WRONG_PASSWORD });
    try {
      await auth.api.verifyPassword({ body: { password: input.password }, headers });
    } catch (error) {
      if (isAPIError(error) && error.statusCode === 400) {
        return rejected(WRONG_PASSWORD, { password: WRONG_PASSWORD });
      }
      throw error;
    }
  } else {
    const found = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    const age = found ? Date.now() - new Date(found.session.createdAt).getTime() : Number.NaN;
    // Written so an unreadable createdAt (NaN) fails closed
    if (!(age <= PASSWORDLESS_FRESH_MS)) return rejected(GOOGLE_AGAIN);
  }

  if (actor.twoFactor.enabled) {
    const code = (input.code ?? "").trim();
    if (!code) return rejected(WRONG_CODE, { code: WRONG_CODE });
    const digits = code.replace(/\s/g, "");
    try {
      if (TOTP_SHAPE.test(digits)) {
        await auth.api.verifyTOTP({ body: { code: digits }, headers });
      } else {
        await auth.api.verifyBackupCode({ body: { code: normaliseBackupCode(code) }, headers });
      }
    } catch (error) {
      if (isAPIError(error)) {
        if (error.statusCode === 429) return rejected(LOCKED, { code: LOCKED });
        if (error.statusCode === 401) return rejected(WRONG_CODE, { code: WRONG_CODE });
      }
      throw error;
    }
  }
  return null;
}
