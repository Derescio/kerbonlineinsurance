import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import { deleteAccount, INSURANCE_RECORDS } from "#/server/account/delete";
import type { AccountDeps } from "#/server/account/emails";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { customers, policies, quotes, users } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import type { JobDeps } from "#/server/jobs/types";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeUser } from "#/test/factories";

import { payForQuote } from "./pay";
import { saveCarQuoteFor } from "./save";

// A purchase racing an account delete (5.6, decision 7 step 1). Pay locks the users row before the
// customer, as deleteAccount does, so the two serialise: whichever holds the lock first finishes,
// and the other sees its result and refuses cleanly, never with a raw foreign key error. Each test
// pauses the first write inside its transaction (in audit(), which both call while holding their
// locks), starts the second, waits until Postgres shows it blocked on a lock, then lets go.

const gate = vi.hoisted(() => ({
  action: null as string | null,
  reached: () => undefined as void,
  release: Promise.resolve(),
}));

vi.mock("#/server/audit/audit", async (original) => {
  const real = await original<typeof import("#/server/audit/audit")>();
  return {
    ...real,
    audit: vi.fn(async (...args: Parameters<typeof real.audit>) => {
      if (gate.action && args[1].action === gate.action) {
        gate.action = null;
        gate.reached();
        await gate.release;
      }
      return real.audit(...args);
    }),
  };
});

// The identity proof (password, two-factor) is account.int.test.ts's; here only the locks matter
vi.mock("#/server/account/confirm", () => ({
  proveIdentity: async () => ({ ok: true, sessionId: "session" }),
}));

const NOW = new Date("2026-11-11T12:00:00Z");
const ctx = { headers: new Headers() };
const payDeps: JobDeps & { now: Date } = {
  sendEmail: vi.fn(),
  defer: () => undefined,
  holdEmails: true,
  now: NOW,
};
const accountDeps: AccountDeps = { sendEmail: vi.fn(), defer: () => undefined };

/** Pauses the next audit() of `action`; resolves `reached` once it's there, and `open()` lets go */
function hold(action: string) {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    gate.reached = resolve;
  });
  gate.release = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate.action = action;
  return { reached, open };
}

/** Until another connection is waiting on a row lock */
async function blockedOnLock(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { rows } = await getDb().$client.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
    );
    if (rows[0]!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the second write never waited on a lock");
}

async function customerWithQuote(): Promise<{ actor: Actor; quoteId: string; userId: string }> {
  const user = await makeUser();
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  const saved = await withTx(getDb(), (tx) => saveCarQuoteFor(tx, user.id, { journey, now: NOW }));
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, quoteId: saved.quoteId, userId: user.id };
}

const pay = (actor: Actor, quoteId: string) =>
  payForQuote(
    actor,
    {
      input: {
        quoteId,
        plan: "annual",
        startsOn: "2026-11-20",
        card: {
          name: "Alex Morgan",
          number: "4242 4242 4242 4242",
          expiry: "12 / 30",
          code: "123",
        },
        detailsConfirmed: true,
        coverAcknowledged: true,
      },
      idempotencyKey: randomUUID(),
    },
    ctx,
    payDeps,
  );

const del = (actor: Actor) =>
  deleteAccount(actor, { input: { password: "x" } }, ctx, accountDeps, {} as never);

beforeAll(async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
  gate.action = null;
});
afterEach(() => {
  gate.action = null;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("payForQuote racing deleteAccount", () => {
  it("pay first: the delete waits, then sees the policy and refuses with INSURANCE_RECORDS", async () => {
    const { actor, quoteId, userId } = await customerWithQuote();
    const paused = hold("policy.purchased");
    const paying = pay(actor, quoteId);
    await paused.reached;
    const deleting = del(actor);
    await blockedOnLock();
    paused.open();

    const [paid, deleted] = await Promise.all([paying, deleting]);
    expect(paid.ok).toBe(true);
    expect(deleted).toEqual({
      ok: false,
      error: expect.objectContaining({ message: INSURANCE_RECORDS }),
    });
    expect(await getDb().select().from(users).where(eq(users.id, userId))).toHaveLength(1);
    expect(await getDb().select().from(policies)).toHaveLength(1);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.status).toBe("accepted");
  });

  it("delete first: the pay waits, then finds the user gone, with nothing written", async () => {
    const { actor, quoteId, userId } = await customerWithQuote();
    const paused = hold("account.deleted");
    const deleting = del(actor);
    await paused.reached;
    const paying = pay(actor, quoteId).then(
      () => null,
      (error: unknown) => error,
    );
    await blockedOnLock();
    paused.open();

    expect(await deleting).toEqual({ ok: true, data: { deleted: true } });
    const error = await paying;
    expect(error).toBeInstanceOf(AuthzError);
    expect((error as AuthzError).code).toBe("UNAUTHENTICATED");
    expect(await getDb().select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    expect(await getDb().select().from(customers)).toHaveLength(0);
    expect(await getDb().select().from(policies)).toHaveLength(0);
    expect((await getDb().execute(sql`select 1 from quotes`)).rows).toHaveLength(0);
  });
});
