import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { audit } from "#/server/audit/audit";
import { verifyAuditChain } from "#/server/audit/verify";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError, RateLimitError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import {
  accountClosures,
  accounts,
  auditLog,
  customers,
  deletedRows,
  files,
  idempotencyKeys,
  jobs,
  quotes,
  securityEvents,
  sessions,
  users,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { getAuditEnv } from "#/server/env";
import {
  env,
  makeAuth,
  PASSWORD,
  requestHeaders,
  sent,
  sessionCookie,
  signInWithPassword,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { tamper, truncateAll } from "#/test/db";
import { makeCustomer, makeFile, makePolicy, makeQuote, makeStaff } from "#/test/factories";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";

import { cancelClosure, requestClosure } from "./closure";
import { clearSessionCookies, deleteAccount } from "./delete";
import type { AccountDeps } from "./emails";
import { filesHook } from "./files";

const EMAIL = "maya.patel@example.com";
const INSURANCE_RECORDS = "You have insurance records, so your account will be closed instead.";
const ALREADY_CLOSING = "Your account is already closing.";
const NOTHING_ON_FILE =
  "You have no insurance records, so your account can be deleted straight away instead.";

// Emails go out through `defer`, as in production; the tests await what was deferred
const pending: Promise<unknown>[] = [];
const deps: AccountDeps = {
  sendEmail: async (message) => {
    sent.push(message);
  },
  defer: (work) => {
    pending.push(work);
  },
};
const flush = async () => {
  await Promise.all(pending.splice(0));
};

afterAll(closeDb);
beforeEach(async () => {
  // rateLimitSubject reads its secret from the whole auth env, which this project doesn't set
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  sent.length = 0;
  pending.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A signed-up, email-confirmed user with a session; `sent` is emptied afterwards */
async function member(auth: TestAuth) {
  const { user } = await signUp(auth, EMAIL);
  const message = sent.filter((m) => m.to === EMAIL).at(-1)!;
  const url = /(http\S+verify-email\?token=\S+)/.exec(message.text)![1]!;
  const response = await auth.handler(new Request(url, { headers: requestHeaders() }));
  const cookie = sessionCookie(response);
  sent.length = 0;
  const actor = (await resolveActor(getDb(), user.id))!;
  return { user, cookie, actor };
}

const headersFor = (cookie: string) => ({ headers: requestHeaders({ cookie }) });

function del(auth: TestAuth, actor: Actor | null, cookie: string, password = PASSWORD) {
  return deleteAccount(actor, { input: { password } }, headersFor(cookie), deps, auth as never);
}

function request(auth: TestAuth, actor: Actor, cookie: string, key: string = randomUUID()) {
  return requestClosure(
    actor,
    { input: { password: PASSWORD }, idempotencyKey: key },
    headersFor(cookie),
    deps,
    auth as never,
  );
}

function cancel(actor: Actor, cookie: string, key: string = randomUUID()) {
  return cancelClosure(actor, { input: {}, idempotencyKey: key }, headersFor(cookie), deps);
}

async function codeOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (error instanceof AuthzError) return error.code;
    throw error;
  }
  return null;
}

/** RATE_LIMITED when the call throws the limiter's error (the middleware's public code) */
async function limitedOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (error instanceof RateLimitError) return "RATE_LIMITED";
    throw error;
  }
  return null;
}

const actionRows = (action: string) =>
  getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action as never));

const closuresOf = (userId: string) =>
  getDb().select().from(accountClosures).where(eq(accountClosures.userId, userId));

const userExists = async (userId: string) =>
  (await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId))).length === 1;

/** A customer row with a policy, so the user has insurance records */
async function withPolicy(userId: string) {
  const customer = await makeCustomer({ userId });
  return makePolicy({ customerId: customer.id });
}

describe("deleteAccount", () => {
  it("expires the session cookies after the delete, even though the session row is gone", async () => {
    const auth = makeAuth();
    const { cookie, actor } = await member(auth);
    expect((await del(auth, actor, cookie)).ok).toBe(true);
    const out = await clearSessionCookies(requestHeaders({ cookie }), auth as never);
    const set = out.getSetCookie().join(" | ");
    expect(set).toMatch(/session_token=;.*?Max-Age=0/i);
    expect(set).toMatch(/session_data=;.*?Max-Age=0/i);
  });

  it("removes a fresh sign-up and its rows, and tombstones the copied ones", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    const customer = await makeCustomer({ userId: user.id });
    const { quote } = await makeQuote({ customerId: customer.id });
    await getDb()
      .insert(idempotencyKeys)
      .values({
        userId: user.id,
        key: randomUUID(),
        requestHash: "x",
        response: {},
        expiresAt: new Date(Date.now() + 60_000),
      });
    // An earlier audit row of the user's, which must outlive them
    await withTx(getDb(), (tx) =>
      audit(tx, { actor, action: "two_factor.disabled", entityId: user.id }),
    );
    const countFor = async (table: typeof sessions | typeof accounts | typeof securityEvents) =>
      (await getDb().select().from(table).where(eq(table.userId, user.id))).length;
    expect(await countFor(sessions)).toBeGreaterThan(0);
    expect(await countFor(accounts)).toBeGreaterThan(0);
    expect(await countFor(securityEvents)).toBeGreaterThan(0);
    // The actor is resolved after the customer row exists, as getActor would
    const fresh = (await resolveActor(getDb(), user.id))!;

    const result = await del(auth, fresh, cookie);
    await flush();

    expect(result).toEqual({ ok: true, data: { deleted: true } });
    expect(await userExists(user.id)).toBe(false);
    expect(await countFor(sessions)).toBe(0);
    expect(await countFor(accounts)).toBe(0);
    expect(await countFor(securityEvents)).toBe(0);
    expect(
      await getDb().select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, user.id)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(customers).where(eq(customers.id, customer.id)),
    ).toHaveLength(0);
    expect(await getDb().select().from(quotes).where(eq(quotes.id, quote.id))).toHaveLength(0);

    const tombstones = await getDb()
      .select({ tableName: deletedRows.tableName, rowId: deletedRows.rowId })
      .from(deletedRows);
    expect(tombstones).toEqual(
      expect.arrayContaining([
        { tableName: "users", rowId: user.id },
        { tableName: "customers", rowId: customer.id },
        { tableName: "quotes", rowId: quote.id },
      ]),
    );

    const deleted = await actionRows("account.deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ actorUserId: user.id, entityId: user.id });
    expect(await actionRows("two_factor.disabled")).toHaveLength(1);
    expect(await verifyAuditChain(getDb().$client, getAuditEnv())).toMatchObject({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: EMAIL, subject: "Your Kerb account has been deleted" });
  });

  it("calls deleteUserFiles once inside the transaction, before the user goes", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    let seen: number | null = null;
    const spy = vi.spyOn(filesHook, "deleteUserFiles").mockImplementation(async (tx, userId) => {
      seen = (await tx.select().from(users).where(eq(users.id, userId))).length;
      return [];
    });

    expect((await del(auth, actor, cookie)).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toBe(user.id);
    // Not the pool: the transaction, where the user row is still there
    expect(spy.mock.calls[0]![0]).not.toBe(getDb());
    expect(seen).toBe(1);
  });

  it("rolls everything back when deleteUserFiles throws", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    vi.spyOn(filesHook, "deleteUserFiles").mockRejectedValue(new Error("R2 is down"));

    await expect(del(auth, actor, cookie)).rejects.toThrow("R2 is down");
    await flush();
    expect(await userExists(user.id)).toBe(true);
    expect(await actionRows("account.deleted")).toHaveLength(0);
    expect(await getDb().select().from(deletedRows)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  describe("the user's files (4.10)", () => {
    let store: MemoryObjectStore;
    beforeEach(() => {
      store = new MemoryObjectStore();
      setObjectStore(store);
    });
    afterEach(() => setObjectStore(null));

    /** A file the user owns. A deletable user has no claims, so it sits on someone else's */
    async function ownedFile(userId: string) {
      const file = await makeFile({ ownerUserId: userId });
      store.put(file.objectKey, new Uint8Array([1]), file.mime);
      store.put(file.thumbKey!, new Uint8Array([1]), file.mime);
      return file;
    }
    const fileRow = async (id: string) =>
      (await getDb().select().from(files).where(eq(files.id, id)))[0]!;

    it("marks them deleted in the transaction and removes the objects after the commit", async () => {
      const auth = makeAuth();
      const { user, cookie, actor } = await member(auth);
      const file = await ownedFile(user.id);

      expect((await del(auth, actor, cookie)).ok).toBe(true);
      // Handed to defer once the delete has committed
      expect(pending).toHaveLength(2);
      await flush();
      expect(store.keys()).toEqual([]);
      expect(await fileRow(file.id)).toMatchObject({ status: "deleted", ownerUserId: null });
      expect((await fileRow(file.id)).purgedAt).not.toBeNull();
    });

    it("a rolled-back delete leaves the rows and the objects", async () => {
      const auth = makeAuth();
      const { user, cookie, actor } = await member(auth);
      const file = await ownedFile(user.id);
      const real = filesHook.deleteUserFiles;
      vi.spyOn(filesHook, "deleteUserFiles").mockImplementation(async (tx, userId) => {
        await real(tx, userId);
        throw new Error("later step failed");
      });

      await expect(del(auth, actor, cookie)).rejects.toThrow("later step failed");
      await flush();
      expect(await fileRow(file.id)).toMatchObject({ status: "ready", ownerUserId: user.id });
      expect(store.keys()).toHaveLength(2);
    });

    it("with R2 down, the delete still succeeds and the cleanup has the rows", async () => {
      const auth = makeAuth();
      const { user, cookie, actor } = await member(auth);
      const file = await ownedFile(user.id);
      store.failDeletes = true;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      expect((await del(auth, actor, cookie)).ok).toBe(true);
      await flush();
      expect(await fileRow(file.id)).toMatchObject({ status: "deleted", purgedAt: null });
      expect(logged).toHaveBeenCalledWith("[uploads] purge after delete failed:", {
        name: "Error",
      });
    });
  });

  it("a second call after the first gets UNAUTHENTICATED, never a database error", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    expect((await del(auth, actor, cookie)).ok).toBe(true);

    // What getActor finds for the same cookie now
    const after = await resolveActor(getDb(), user.id);
    expect(after).toBeNull();
    expect(await codeOf(del(auth, after, cookie))).toBe("UNAUTHENTICATED");
    // An actor resolved before the first delete committed (two tabs at once)
    expect(await codeOf(del(auth, actor, cookie))).toBe("UNAUTHENTICATED");
  });

  it("a wrong password changes nothing", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    const result = await del(auth, actor, cookie, "not my password");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.fields).toEqual({ password: "That password isn't right." });
    expect(await userExists(user.id)).toBe(true);
  });

  it("refuses a user with a policy: the insurance records rejection", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;

    const result = await del(auth, actor, cookie);
    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: INSURANCE_RECORDS, fields: {} },
    });
    expect(await userExists(user.id)).toBe(true);
    expect(await actionRows("account.deleted")).toHaveLength(0);
  });

  it("refuses a user with any closure row, even a cancelled one (R3)", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    await tamper(
      `insert into account_closures (user_id, requested_at, closes_at, cancelled_at)
       select $1, now(), now() + interval '30 days', now()`,
      [user.id],
    );
    const result = await del(auth, actor, cookie);
    expect(!result.ok && result.error.message).toBe(INSURANCE_RECORDS);
    expect(await userExists(user.id)).toBe(true);
  });

  it.each([
    ["active", null],
    ["deactivated", new Date()],
  ])("refuses a %s staff user with STAFF_ACCOUNT", async (_label, deactivatedAt) => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    await makeStaff({
      userId: user.id,
      twoFactor: false,
      startedAt: new Date(Date.now() - 86_400_000),
      deactivatedAt,
    });

    expect(await codeOf(del(auth, actor, cookie))).toBe("STAFF_ACCOUNT");
    expect(await userExists(user.id)).toBe(true);
    expect(await actionRows("account.deleted")).toHaveLength(0);
  });

  it("counts wrong passwords: the sixth attempt in an hour is RATE_LIMITED, unchecked", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    for (let i = 0; i < 5; i++) {
      const result = await del(auth, actor, cookie, "not my password");
      expect(!result.ok && result.error.fields).toEqual({ password: "That password isn't right." });
    }
    const verify = vi.spyOn(auth.api, "verifyPassword");
    expect(await limitedOf(del(auth, actor, cookie, "not my password"))).toBe("RATE_LIMITED");
    // Even the right password is refused now, and Better Auth is never asked
    expect(await limitedOf(del(auth, actor, cookie))).toBe("RATE_LIMITED");
    expect(verify).not.toHaveBeenCalled();
    expect(await userExists(user.id)).toBe(true);
  });
});

describe("requestClosure", () => {
  it("opens one closure 30 days out, audits it, ends other sessions and emails", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    // A second device, signed in before the request
    expect((await signInWithPassword(auth, EMAIL)).status).toBe(200);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(
      2,
    );
    const current = (await auth.api.getSession({ headers: requestHeaders({ cookie }) }))!.session
      .id;

    const result = await request(auth, actor, cookie);
    await flush();
    expect(result.ok).toBe(true);
    const { closesAt } = (result as { ok: true; data: { closesAt: string } }).data;

    const rows = await closuresOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.closesAt.toISOString()).toBe(closesAt);
    const { rows: window } = await getDb().execute<{ exact: boolean }>(
      sql`select closes_at = requested_at + interval '30 days' as exact from account_closures where user_id = ${user.id}`,
    );
    expect(window[0]!.exact).toBe(true);

    const requested = await actionRows("account.closure_requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      actorUserId: user.id,
      entityId: user.id,
      changes: { closesAt },
    });

    const left = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(left.map((s) => s.id)).toEqual([current]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: EMAIL, subject: "Your Kerb account is closing" });

    // Signing in during the window (Review Focus 4): works, and the closure is unchanged
    expect((await signInWithPassword(auth, EMAIL)).status).toBe(200);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(
      2,
    );
    expect(await closuresOf(user.id)).toEqual(rows);
  });

  it("the same key acts once; a new key is refused", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    const key = randomUUID();

    const first = await request(auth, actor, cookie, key);
    const again = await request(auth, actor, cookie, key);
    await flush();
    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    expect(await closuresOf(user.id)).toHaveLength(1);
    expect(await actionRows("account.closure_requested")).toHaveLength(1);
    expect(sent).toHaveLength(1);

    const jobsBefore = (await getDb().select().from(jobs)).length;
    const other = await request(auth, actor, cookie);
    expect(other).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: ALREADY_CLOSING, fields: {} },
    });
    expect(await closuresOf(user.id)).toHaveLength(1);
    // The refusal rolled back, and its email job with it (4.11)
    expect(await getDb().select().from(jobs)).toHaveLength(jobsBefore);
  });

  it("refuses a user with nothing on file: they can delete instead", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await member(auth);
    const result = await request(auth, actor, cookie);
    expect(!result.ok && result.error.message).toBe(NOTHING_ON_FILE);
    expect(await closuresOf(user.id)).toHaveLength(0);
    expect(await actionRows("account.closure_requested")).toHaveLength(0);
  });

  it("refuses a staff user with STAFF_ACCOUNT", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    await makeStaff({
      userId: user.id,
      twoFactor: false,
      startedAt: new Date(Date.now() - 86_400_000),
      deactivatedAt: new Date(),
    });
    const actor = (await resolveActor(getDb(), user.id))!;
    expect(await codeOf(request(auth, actor, cookie))).toBe("STAFF_ACCOUNT");
    expect(await closuresOf(user.id)).toHaveLength(0);
  });

  it("a wrong password opens nothing", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    const result = await requestClosure(
      actor,
      { input: { password: "nope nope nope" }, idempotencyKey: randomUUID() },
      headersFor(cookie),
      deps,
      auth as never,
    );
    expect(!result.ok && result.error.fields).toEqual({ password: "That password isn't right." });
    expect(await closuresOf(user.id)).toHaveLength(0);
  });

  it("counts wrong passwords: the sixth attempt in an hour is RATE_LIMITED, unchecked", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    const attempt = (password: string) =>
      requestClosure(
        actor,
        { input: { password }, idempotencyKey: randomUUID() },
        headersFor(cookie),
        deps,
        auth as never,
      );
    for (let i = 0; i < 5; i++) {
      const result = await attempt("nope nope nope");
      expect(!result.ok && result.error.fields).toEqual({ password: "That password isn't right." });
    }
    const verify = vi.spyOn(auth.api, "verifyPassword");
    expect(await limitedOf(attempt("nope nope nope"))).toBe("RATE_LIMITED");
    expect(await limitedOf(attempt(PASSWORD))).toBe("RATE_LIMITED");
    expect(verify).not.toHaveBeenCalled();
    expect(await closuresOf(user.id)).toHaveLength(0);
  });

  it("a replay of a committed request is neither counted nor re-proved", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    const key = randomUUID();
    const first = await request(auth, actor, cookie, key);
    expect(first.ok).toBe(true);

    const verify = vi.spyOn(auth.api, "verifyPassword");
    // More replays than the limit allows attempts: each still gets the stored answer
    for (let i = 0; i < 6; i++) expect(await request(auth, actor, cookie, key)).toEqual(first);
    expect(verify).not.toHaveBeenCalled();
    expect(await closuresOf(user.id)).toHaveLength(1);
  });
});

describe("cancelClosure", () => {
  async function closing(auth: TestAuth) {
    const { user, cookie } = await member(auth);
    await withPolicy(user.id);
    const actor = (await resolveActor(getDb(), user.id))!;
    expect((await request(auth, actor, cookie)).ok).toBe(true);
    await flush();
    sent.length = 0;
    return { user, cookie, actor };
  }

  it("cancels an open closure, audits it and emails", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await closing(auth);
    const before = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));

    const result = await cancel(actor, cookie);
    await flush();
    expect(result).toEqual({ ok: true, data: { kept: true } });
    const [row] = await closuresOf(user.id);
    expect(row!.cancelledAt).not.toBeNull();
    const cancelled = await actionRows("account.closure_cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ actorUserId: user.id, entityId: user.id });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: EMAIL, subject: "You're keeping your Kerb account" });
    // Cancelling changes nothing about sessions
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, user.id))).toEqual(
      before,
    );
  });

  it("the same key acts once", async () => {
    const auth = makeAuth();
    const { cookie, actor } = await closing(auth);
    const key = randomUUID();
    const first = await cancel(actor, cookie, key);
    const again = await cancel(actor, cookie, key);
    await flush();
    expect(again).toEqual(first);
    expect(await actionRows("account.closure_cancelled")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("with no open closure: CLOSURE_NOT_OPEN", async () => {
    const auth = makeAuth();
    const { cookie, actor } = await member(auth);
    expect(await codeOf(cancel(actor, cookie))).toBe("CLOSURE_NOT_OPEN");
    expect(await actionRows("account.closure_cancelled")).toHaveLength(0);
  });

  it("after the account closed: ACCOUNT_CLOSED", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await closing(auth);
    // The job closes it while this actor is still in hand
    await tamper(
      "update account_closures set closed_at = now() where user_id = $1 and cancelled_at is null",
      [user.id],
    );
    expect(await codeOf(cancel(actor, cookie))).toBe("ACCOUNT_CLOSED");
    const [row] = await closuresOf(user.id);
    expect(row!.cancelledAt).toBeNull();
  });

  it("a new request after a cancel starts a second row", async () => {
    const auth = makeAuth();
    const { user, cookie, actor } = await closing(auth);
    expect((await cancel(actor, cookie)).ok).toBe(true);
    expect((await request(auth, actor, cookie)).ok).toBe(true);
    const rows = await closuresOf(user.id);
    expect(rows).toHaveLength(2);
    expect(
      rows.filter((r) => r.cancelledAt === null && r.closedAt === null).map((r) => r.userId),
    ).toEqual([user.id]);
  });
});
