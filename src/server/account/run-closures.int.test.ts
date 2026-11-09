import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getActor, resolveActor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import {
  accountClosures,
  accounts,
  auditLog,
  claims,
  customers,
  files,
  idempotencyKeys,
  notifications,
  payments,
  policies,
  quotes,
  rateLimits,
  reviews,
  securityEvents,
  sessions,
  twoFactors,
  users,
  verifications,
} from "#/server/db/schema";
import { accountClosedEmail, closureHeldEmail } from "#/server/email/templates";
import {
  env,
  makeAuth,
  post,
  requestHeaders,
  sent,
  sessionCookie,
  signUp,
  type TestAuth,
} from "#/test/auth";
import { truncateAll } from "#/test/db";
import {
  makeClaim,
  makeCustomer,
  makeFile,
  makePayment,
  makePolicy,
  makeQuote,
  makeReview,
  makeUser,
} from "#/test/factories";

import { cancelClosure } from "./closure";
import type { AccountDeps } from "./emails";
import { runClosures } from "./run-closures";

const EMAIL = "maya.patel@example.com";
const DAY = 24 * 60 * 60 * 1000;

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
  // rateLimitSubject and getActor read the auth env, which this project doesn't set
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  sent.length = 0;
  pending.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Opens a closure now, as insertClosure does: closes_at is requested_at + 30 days in SQL */
async function openClosure(userId: string) {
  const [row] = await getDb()
    .insert(accountClosures)
    .values({
      userId,
      requestedAt: sql`now()`,
      closesAt: sql`now() + interval '30 days'`,
    })
    .returning();
  return row!;
}

/** Just after the window ends: Postgres keeps microseconds, a Date only milliseconds */
const dueAt = (closure: { closesAt: Date }, days = 0) =>
  new Date(closure.closesAt.getTime() + 1000 + days * DAY);

const closureRow = async (id: string) =>
  (await getDb().select().from(accountClosures).where(eq(accountClosures.id, id)))[0]!;

const actionRows = (action: string) =>
  getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, action as never));

/** A user with a customer row and a live policy (insurance records on file) */
async function insured(userId?: string) {
  const user = userId ? { id: userId } : await makeUser();
  const customer = await makeCustomer({ userId: user.id });
  const policy = await makePolicy({ customerId: customer.id });
  return { userId: user.id, customer, policy };
}

/** A signed-up, email-confirmed user with a session; `sent` is emptied afterwards */
async function member(auth: TestAuth) {
  const { user } = await signUp(auth, EMAIL);
  const message = sent.filter((m) => m.to === EMAIL).at(-1)!;
  const url = /(http\S+verify-email\?token=\S+)/.exec(message.text)![1]!;
  const response = await auth.handler(new Request(url, { headers: requestHeaders() }));
  const cookie = sessionCookie(response);
  sent.length = 0;
  return { user, cookie };
}

describe("runClosures", () => {
  it("before day 30 changes nothing", async () => {
    const { userId } = await insured();
    const closure = await openClosure(userId);

    const result = await runClosures(getDb(), new Date(closure.closesAt.getTime() - DAY), deps);

    expect(result).toEqual({ closed: 0, held: 0, failed: 0 });
    const row = await closureRow(closure.id);
    expect(row.closedAt).toBeNull();
    expect(row.heldSince).toBeNull();
    expect(await actionRows("account.closed")).toHaveLength(0);
  });

  it("on day 30 with only a settled claim, closes: keeps the records, scrubs the user", async () => {
    const auth = makeAuth();
    const { user } = await member(auth);
    const userId = user.id;
    const customer = await makeCustomer({ userId });
    const policy = await makePolicy({ customerId: customer.id });
    const settled = await makeClaim({
      status: "settled",
      policyId: policy.id,
      customerId: customer.id,
    });
    const draft = await makeClaim({
      status: "draft",
      policyId: policy.id,
      customerId: customer.id,
    });
    const payment = await makePayment({ customerId: customer.id, quoteId: policy.quoteId });
    // A quote never bought and never paid: goes
    const { quote: unbought } = await makeQuote({ customerId: customer.id });
    // A quote never bought but with a refunded payment: stays (Review Focus 5)
    const { quote: refundedQuote } = await makeQuote({ customerId: customer.id });
    const refund = await makePayment({
      customerId: customer.id,
      quoteId: refundedQuote.id,
      status: "refunded",
    });
    await getDb().insert(twoFactors).values({
      id: randomUUID(),
      secret: "secret",
      backupCodes: "codes",
      userId,
    });
    await getDb().insert(notifications).values({
      userId,
      type: "claim.updated",
      title: "Your claim moved on",
      body: "It's settled.",
    });
    await getDb().insert(reviews).values({
      policyId: policy.id,
      customerId: customer.id,
      rating: 5,
      title: "Good",
      body: "Quick and fair.",
    });
    await getDb()
      .insert(idempotencyKeys)
      .values({
        userId,
        key: randomUUID(),
        requestHash: "x",
        expiresAt: new Date(Date.now() + DAY),
      });
    await getDb()
      .insert(rateLimits)
      .values([
        { key: `account.close:user:${userId}`, windowStart: new Date(), count: 1 },
        { key: "account.close:user:someone-else", windowStart: new Date(), count: 1 },
      ]);
    const eventsBefore = await getDb()
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.userId, userId));
    expect(eventsBefore.length).toBeGreaterThan(0);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(
      1,
    );

    const closure = await openClosure(userId);
    const result = await runClosures(getDb(), dueAt(closure), deps);
    await flush();

    expect(result).toEqual({ closed: 1, held: 0, failed: 0 });

    // The closure row: closed, retained 7 years from the closure (checked in SQL)
    const row = await closureRow(closure.id);
    expect(row.closedAt).not.toBeNull();
    const [{ exact }] = (
      await getDb().execute<{ exact: boolean }>(
        sql`select retain_until = closed_at + interval '7 years' as exact from account_closures where id = ${closure.id}`,
      )
    ).rows as [{ exact: boolean }];
    expect(exact).toBe(true);

    // Audit: by the job, carrying only retainUntil
    const closed = await actionRows("account.closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.actorUserId).toBeNull();
    expect(closed[0]!.entityId).toBe(userId);
    expect(closed[0]!.changes).toEqual({ retainUntil: row.retainUntil!.toISOString() });

    // Kept: the scrubbed user
    const [scrubbed] = await getDb().select().from(users).where(eq(users.id, userId));
    expect(scrubbed).toMatchObject({
      email: `closed+${userId}@closed.invalid`,
      name: "Closed account",
      image: null,
      emailVerified: false,
    });
    // Kept: the insurance records and security events
    const [keptCustomer] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    expect(keptCustomer).toEqual(customer);
    expect(await getDb().select().from(policies).where(eq(policies.id, policy.id))).toHaveLength(1);
    expect(
      await getDb()
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.customerId, customer.id)),
    ).toEqual(expect.arrayContaining([{ id: payment.id }, { id: refund.id }]));
    expect(
      await getDb().select({ id: quotes.id }).from(quotes).where(eq(quotes.id, refundedQuote.id)),
    ).toHaveLength(1);
    const joined = await getDb()
      .select({ id: claims.id })
      .from(claims)
      .innerJoin(customers, eq(customers.id, claims.customerId))
      .where(eq(customers.userId, userId));
    expect(joined).toEqual([{ id: settled.id }]);
    expect(
      await getDb().select().from(securityEvents).where(eq(securityEvents.userId, userId)),
    ).toHaveLength(eventsBefore.length);

    // Gone
    expect(await getDb().select().from(accounts).where(eq(accounts.userId, userId))).toHaveLength(
      0,
    );
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(
      0,
    );
    expect(
      await getDb().select().from(twoFactors).where(eq(twoFactors.userId, userId)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(notifications).where(eq(notifications.userId, userId)),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(reviews).where(eq(reviews.customerId, customer.id)),
    ).toHaveLength(0);
    expect(await getDb().select().from(claims).where(eq(claims.id, draft.id))).toHaveLength(0);
    expect(await getDb().select().from(quotes).where(eq(quotes.id, unbought.id))).toHaveLength(0);
    expect(
      await getDb().select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, userId)),
    ).toHaveLength(0);
    expect(
      (await getDb().select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key),
    ).toEqual(["account.close:user:someone-else"]);

    // One email, to the original address
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(EMAIL);
    expect(sent[0]!.subject).toBe(accountClosedEmail().subject);
  });

  it("holds once for an open claim, then closes after it settles", async () => {
    const { userId, customer, policy } = await insured();
    const [{ email }] = (await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))) as [{ email: string }];
    const claim = await makeClaim({
      status: "assessing",
      policyId: policy.id,
      customerId: customer.id,
    });
    const closure = await openClosure(userId);

    const first = await runClosures(getDb(), dueAt(closure), deps);
    await flush();
    expect(first).toEqual({ closed: 0, held: 1, failed: 0 });
    const held = await closureRow(closure.id);
    expect(held.heldSince).not.toBeNull();
    expect(held.holdReason).toBe(`claim_open:${claim.reference}`);
    expect(held.closedAt).toBeNull();
    const heldRows = await actionRows("account.closure_held");
    expect(heldRows).toHaveLength(1);
    expect(heldRows[0]!.actorUserId).toBeNull();
    expect(heldRows[0]!.changes).toEqual({ reason: `claim_open:${claim.reference}` });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.subject).toBe(closureHeldEmail({ claimReference: claim.reference }).subject);

    // The next day: nothing new
    const second = await runClosures(getDb(), dueAt(closure, 1), deps);
    await flush();
    expect(second).toEqual({ closed: 0, held: 0, failed: 0 });
    expect(await actionRows("account.closure_held")).toHaveLength(1);
    expect(
      await getDb().select().from(accountClosures).where(eq(accountClosures.userId, userId)),
    ).toHaveLength(1);
    expect(sent).toHaveLength(1);

    // The claim settles: the next run closes it
    await getDb().update(claims).set({ status: "settled" }).where(eq(claims.id, claim.id));
    const third = await runClosures(getDb(), dueAt(closure, 2), deps);
    await flush();
    expect(third).toEqual({ closed: 1, held: 0, failed: 0 });
    const done = await closureRow(closure.id);
    const closed = await actionRows("account.closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]!.changes).toEqual({
      heldSince: held.heldSince!.toISOString(),
      retainUntil: done.retainUntil!.toISOString(),
    });
    expect(sent.map((m) => m.subject)).toEqual([
      closureHeldEmail({ claimReference: claim.reference }).subject,
      accountClosedEmail().subject,
    ]);
  });

  it("a draft claim doesn't hold the closure", async () => {
    const { userId, customer, policy } = await insured();
    await makeClaim({ status: "draft", policyId: policy.id, customerId: customer.id });
    const closure = await openClosure(userId);

    expect(await runClosures(getDb(), dueAt(closure), deps)).toEqual({
      closed: 1,
      held: 0,
      failed: 0,
    });
  });

  it("drops draft-claim and review files, and keeps submitted claims' evidence (4.10)", async () => {
    const { userId, customer, policy } = await insured();
    const settled = await makeClaim({
      status: "settled",
      policyId: policy.id,
      customerId: customer.id,
    });
    const draft = await makeClaim({
      status: "draft",
      policyId: policy.id,
      customerId: customer.id,
    });
    const review = await makeReview({ policyId: policy.id, customerId: customer.id });
    const evidence = await makeFile({ claimId: settled.id });
    const draftPhoto = await makeFile({ claimId: draft.id });
    const reviewPhoto = await makeFile({ reviewId: review.id });
    const closure = await openClosure(userId);

    expect(await runClosures(getDb(), dueAt(closure), deps)).toMatchObject({ closed: 1 });
    const after = await getDb().select().from(files).orderBy(files.createdAt);
    expect(after.map((f) => [f.id, f.status, f.claimId, f.reviewId, f.ownerUserId])).toEqual([
      [evidence.id, "ready", settled.id, null, userId],
      [draftPhoto.id, "deleted", null, null, userId],
      [reviewPhoto.id, "deleted", null, null, userId],
    ]);
    // Left for the daily cleanup
    expect(after.every((f) => f.purgedAt === null)).toBe(true);
  });

  it("closes a user whose policies belong to a bundle (Review Focus 5)", async () => {
    const { userId, customer } = await insured();
    const { quote, items } = await makeQuote({
      customerId: customer.id,
      products: ["car", "home"],
    });
    const [bundle] = (
      await getDb().execute<{ id: string }>(
        sql`insert into bundles (customer_id, quote_id) values (${customer.id}, ${quote.id}) returning id`,
      )
    ).rows as [{ id: string }];
    for (const { item } of items) {
      await makePolicy({
        customerId: customer.id,
        quoteId: quote.id,
        quoteItemId: item.id,
        product: item.product,
        bundleId: bundle.id,
      });
    }
    const closure = await openClosure(userId);

    expect(await runClosures(getDb(), dueAt(closure), deps)).toEqual({
      closed: 1,
      held: 0,
      failed: 0,
    });
    expect(await getDb().select().from(quotes).where(eq(quotes.id, quote.id))).toHaveLength(1);
    expect(
      await getDb().select().from(policies).where(eq(policies.bundleId, bundle.id)),
    ).toHaveLength(2);
  });

  it("a second run on the same day does nothing", async () => {
    const { userId } = await insured();
    const closure = await openClosure(userId);

    expect(await runClosures(getDb(), dueAt(closure), deps)).toEqual({
      closed: 1,
      held: 0,
      failed: 0,
    });
    expect(await runClosures(getDb(), dueAt(closure), deps)).toEqual({
      closed: 0,
      held: 0,
      failed: 0,
    });
    expect(await actionRows("account.closed")).toHaveLength(1);
  });

  it("one failing closure doesn't stop the others, and logs no email", async () => {
    const a = await insured();
    const b = await insured();
    const [{ email: aEmail }] = (await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, a.userId))) as [{ email: string }];
    // A broken row: another user already holds A's scrubbed address, so A's scrub fails
    await makeUser({ email: `closed+${a.userId}@closed.invalid` });
    const closureA = await openClosure(a.userId);
    const closureB = await openClosure(b.userId);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const later = dueAt(closureA.closesAt > closureB.closesAt ? closureA : closureB);
    const result = await runClosures(getDb(), later, deps);

    expect(result).toEqual({ closed: 1, held: 0, failed: 1 });
    expect((await closureRow(closureA.id)).closedAt).toBeNull();
    expect((await closureRow(closureB.id)).closedAt).not.toBeNull();
    const [aUser] = await getDb().select().from(users).where(eq(users.id, a.userId));
    expect(aUser!.email).toBe(aEmail);
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain(aEmail);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("@closed.invalid");
  });

  it("after closure: no reset link, no password, a new account on sign-up, no actor", async () => {
    const auth = makeAuth();
    const { user, cookie } = await member(auth);
    await insured(user.id);
    expect((await getActor(new Headers({ cookie })))?.userId).toBe(user.id);

    const request = await post(auth, "/request-password-reset", {
      email: EMAIL,
      redirectTo: "/reset-password",
    });
    expect(request.status).toBe(200);
    const token = /reset-password\/([^?\s]+)/.exec(sent.at(-1)!.text)?.[1];
    expect(token).toBeTruthy();
    expect(
      await getDb().select().from(verifications).where(eq(verifications.value, user.id)),
    ).toHaveLength(1);
    sent.length = 0;

    const closure = await openClosure(user.id);
    expect((await runClosures(getDb(), dueAt(closure), deps)).closed).toBe(1);

    expect(
      await getDb().select().from(verifications).where(eq(verifications.value, user.id)),
    ).toHaveLength(0);
    const reset = await post(auth, "/reset-password", {
      newPassword: "a brand new password",
      token,
    });
    expect(reset.status).not.toBe(200);
    expect(await getDb().select().from(accounts).where(eq(accounts.userId, user.id))).toHaveLength(
      0,
    );

    const { user: again } = await signUp(auth, EMAIL);
    expect(again.id).not.toBe(user.id);

    expect(await getActor(new Headers({ cookie }))).toBeNull();
    expect(await resolveActor(getDb(), user.id)).toBeNull();
  });
});

describe("runClosures racing cancelClosure (Review Focus 1)", () => {
  async function due() {
    const { userId } = await insured();
    const closure = await openClosure(userId);
    const actor = (await resolveActor(getDb(), userId))!;
    return { userId, closure, actor };
  }

  const cancel = (actor: Parameters<typeof cancelClosure>[0]) =>
    cancelClosure(
      actor,
      { input: {}, idempotencyKey: randomUUID() },
      { headers: requestHeaders() },
      deps,
    );

  it("started together, exactly one wins and neither throws an unexpected error", async () => {
    for (let round = 0; round < 3; round++) {
      await truncateAll();
      const { closure, actor } = await due();

      const [cancelled, run] = await Promise.allSettled([
        cancel(actor),
        runClosures(getDb(), dueAt(closure), deps),
      ]);
      await flush();

      const row = await closureRow(closure.id);
      expect([row.cancelledAt, row.closedAt].filter(Boolean)).toHaveLength(1);
      expect(run.status).toBe("fulfilled");
      const counts = (run as PromiseFulfilledResult<{ closed: number; failed: number }>).value;
      expect(counts.failed).toBe(0);
      if (row.closedAt) {
        expect(counts.closed).toBe(1);
        // The cancel lost
        expect(cancelled.status).toBe("rejected");
        const reason = (cancelled as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(AuthzError);
        expect((reason as AuthzError).code).toBe("ACCOUNT_CLOSED");
      } else {
        expect(counts.closed).toBe(0);
        expect(cancelled.status).toBe("fulfilled");
        expect((cancelled as PromiseFulfilledResult<{ ok: boolean }>).value.ok).toBe(true);
      }
    }
  });

  it("a cancel that has its key row when the job starts wins: no deadlock, the job skips", async () => {
    const { userId, closure } = await due();
    let job: Promise<unknown> | undefined;

    // cancelClosure's order inside withIdempotency: the key row (a KEY SHARE on the user), then,
    // after the job has started, the closure row FOR UPDATE. Were the job to lock the closure
    // before the user, each would wait on the other.
    await getDb().transaction(async (tx) => {
      await tx.insert(idempotencyKeys).values({
        userId,
        key: randomUUID(),
        requestHash: "x",
        expiresAt: new Date(Date.now() + DAY),
      });
      job = runClosures(getDb(), dueAt(closure), deps);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx
        .select({ id: accountClosures.id })
        .from(accountClosures)
        .where(eq(accountClosures.id, closure.id))
        .for("update");
      await tx
        .update(accountClosures)
        .set({ cancelledAt: sql`now()` })
        .where(eq(accountClosures.id, closure.id));
    });

    expect(await job).toEqual({ closed: 0, held: 0, failed: 0 });
    const row = await closureRow(closure.id);
    expect(row.cancelledAt).not.toBeNull();
    expect(row.closedAt).toBeNull();
  });
});
