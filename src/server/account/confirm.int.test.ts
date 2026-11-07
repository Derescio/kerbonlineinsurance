import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { twoFactors } from "#/server/db/schema";
import { resolveActor } from "#/server/auth/actor";
import {
  enableTwoFactor,
  googleSession,
  makeAuth,
  PASSWORD,
  requestHeaders,
  sent,
  sessionCookie,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { tamper, truncateAll } from "#/test/db";
import { totpNow } from "#/test/totp";

import { confirmIdentity } from "./confirm";

const EMAIL = "maya.patel@example.com";

afterAll(closeDb);
beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
});

async function confirmedCookie(auth: TestAuth) {
  const { user } = await signUp(auth, EMAIL);
  const message = sent.filter((m) => m.to === EMAIL).at(-1)!;
  const url = /(http\S+verify-email\?token=\S+)/.exec(message.text)![1]!;
  const response = await auth.handler(new Request(url, { headers: requestHeaders() }));
  return { user, cookie: sessionCookie(response) };
}

/** Runs confirmIdentity as the user behind `cookie` */
async function confirm(
  auth: TestAuth,
  userId: string,
  cookie: string,
  input: { password?: string; code?: string },
) {
  const actor = (await resolveActor(getDb(), userId))!;
  return confirmIdentity(actor, input, requestHeaders({ cookie }), auth as never);
}

const row = async (userId: string) =>
  (await getDb().select().from(twoFactors).where(eq(twoFactors.userId, userId)))[0]!;

describe("confirmIdentity", () => {
  it("password: right proves it, wrong is rejected with a field", async () => {
    const auth = makeAuth();
    const { user, cookie } = await confirmedCookie(auth);
    expect(await confirm(auth, user.id, cookie, { password: PASSWORD })).toBeNull();
    const wrong = await confirm(auth, user.id, cookie, { password: "nope nope nope" });
    expect(wrong?.error.fields).toEqual({ password: "That password isn't right." });
    const missing = await confirm(auth, user.id, cookie, {});
    expect(missing?.error.fields).toHaveProperty("password");
  });

  it("Google-only: fresh passes, 11 minutes old is rejected", async () => {
    const auth = makeAuth();
    const user = (await signUp(auth, EMAIL)).user;
    // No password: drop the credential account
    await tamper("delete from accounts where user_id = $1", [user.id]);
    const cookie = await googleSession(auth, user.id);
    expect(await confirm(auth, user.id, cookie, {})).toBeNull();
    await tamper(
      "update sessions set created_at = now() - interval '9 minutes' where user_id = $1",
      [user.id],
    );
    expect(await confirm(auth, user.id, cookie, {})).toBeNull();
    await tamper(
      "update sessions set created_at = now() - interval '11 minutes' where user_id = $1",
      [user.id],
    );
    const old = await confirm(auth, user.id, cookie, {});
    expect(old?.error.message).toBe("Sign in with Google again to confirm it's you.");
    expect(old?.error.fields).toEqual({});
  });

  it("Google and a password: the password is required whatever the session age", async () => {
    const auth = makeAuth();
    const { user } = await signUp(auth, EMAIL);
    const cookie = await googleSession(auth, user.id);
    await tamper("update sessions set created_at = now() - interval '2 hours' where user_id = $1", [
      user.id,
    ]);
    expect(await confirm(auth, user.id, cookie, { password: PASSWORD })).toBeNull();
    const none = await confirm(auth, user.id, cookie, {});
    expect(none?.error.fields).toHaveProperty("password");
  });

  describe("with two-factor on", () => {
    async function setup() {
      const auth = makeAuth();
      const base = await confirmedCookie(auth);
      const enabled = await enableTwoFactor(auth, base.cookie);
      return { auth, user: base.user, ...enabled };
    }

    it("no code is rejected with a code field", async () => {
      const { auth, user, cookie } = await setup();
      const result = await confirm(auth, user.id, cookie, { password: PASSWORD });
      expect(result?.error.fields).toHaveProperty("code");
    });

    it("a wrong code is rejected and counted; the right one proves it", async () => {
      const { auth, user, cookie, secret } = await setup();
      const before = (await row(user.id)).failedVerificationCount ?? 0;
      const wrong = await confirm(auth, user.id, cookie, { password: PASSWORD, code: "000000" });
      expect(wrong?.error.fields).toEqual({ code: "That code isn't right." });
      expect((await row(user.id)).failedVerificationCount).toBe(before + 1);
      const ok = await confirm(auth, user.id, cookie, {
        password: PASSWORD,
        code: await totpNow(secret),
      });
      expect(ok).toBeNull();
      expect((await row(user.id)).failedVerificationCount).toBe(0);
    });

    it("a backup code proves it once", async () => {
      const { auth, user, cookie, backupCodes } = await setup();
      const typed = backupCodes[0]!.toLowerCase();
      expect(await confirm(auth, user.id, cookie, { password: PASSWORD, code: typed })).toBeNull();
      const again = await confirm(auth, user.id, cookie, {
        password: PASSWORD,
        code: backupCodes[0]!,
      });
      expect(again?.error.fields).toHaveProperty("code");
    });

    it("the 10th wrong code locks the account; an 11th with the right code is rejected", async () => {
      const { auth, user, cookie, secret } = await setup();
      for (let i = 0; i < 10; i++) {
        const r = await confirm(auth, user.id, cookie, { password: PASSWORD, code: "000000" });
        expect(r?.error.fields).toHaveProperty("code");
      }
      expect((await row(user.id)).lockedUntil).not.toBeNull();
      const locked = await confirm(auth, user.id, cookie, {
        password: PASSWORD,
        code: await totpNow(secret),
      });
      expect(locked?.error.fields.code).toBe("Too many wrong codes. Try again in 15 minutes.");
    });

    it("Google session with a password and 2FA: asks for password and code, not fresh Google", async () => {
      const { auth, user, secret } = await setup();
      const cookie = await googleSession(auth, user.id);
      await tamper(
        "update sessions set created_at = now() - interval '2 hours', two_factor_verified_at = now() where user_id = $1 and token = $2",
        [user.id, decodeURIComponent(cookie.split("=")[1]!).split(".")[0]!],
      );
      const result = await confirm(auth, user.id, cookie, {
        password: PASSWORD,
        code: await totpNow(secret),
      });
      expect(result).toBeNull();
    });
  });
});
