import { eq } from "drizzle-orm";
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
import type { Journey } from "#/features/quote/journey-store";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { QUOTE_SAVE_RULE } from "#/server/data/rate-limit-rules";
import { closeDb, getDb } from "#/server/db/client";
import { rateLimitSubject } from "#/server/db/rate-limit";
import { customers, quotes, rateLimits, users } from "#/server/db/schema";
import { saveCarQuoteFor } from "#/server/quote/save";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { makeAuth, PASSWORD, post, requestHeaders, SECRET, sent, signUp } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";

// The real save, with a spy so one test can make it throw
vi.mock("#/server/quote/save", async (original) => {
  const real = await original<typeof import("#/server/quote/save")>();
  return { ...real, saveCarQuoteFor: vi.fn(real.saveCarQuoteFor) };
});

// Creating an account mid-quote saves the quote against the new user, in the sign-up request
// itself (5.6, decision 1, option A). Only a user this sign-up created gets it, and sign-up never
// fails because of the quote.

const EMAIL = "maya.patel@example.com";

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

const signUpWithQuote = (journey: unknown, email = EMAIL) =>
  post(makeAuth(), "/sign-up/email", {
    name: "Maya Patel",
    email,
    password: PASSWORD,
    acceptTerms: true,
    callbackURL: "/email-confirmed",
    quote: { journey },
  });

const userByEmail = async (email = EMAIL) =>
  (await getDb().select().from(users).where(eq(users.email, email)))[0];

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
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
  sent.length = 0;
  vi.mocked(saveCarQuoteFor).mockClear();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

describe("sign-up with a quote (5.6, decision 1)", () => {
  it("makes one user, one customer and one priced quote", async () => {
    const journey = await golf();
    const response = await signUpWithQuote(journey);
    expect(response.status).toBe(200);
    const user = await userByEmail();
    expect(user).toBeDefined();
    // The probe (Step 1): Better Auth keeps the extra body field, so the hook reads ctx.body.quote
    expect(saveCarQuoteFor).toHaveBeenCalledWith(expect.anything(), user!.id, { journey });
    const rows = await getDb().select().from(customers);
    expect(rows).toEqual([expect.objectContaining({ userId: user!.id, lastName: "Morgan" })]);
    const saved = await getDb().select().from(quotes);
    expect(saved).toEqual([expect.objectContaining({ customerId: rows[0]!.id, status: "priced" })]);
  });

  it("attaches nothing to an existing confirmed account", async () => {
    const { user } = await signUp(makeAuth());
    await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));

    const response = await signUpWithQuote(await golf());
    expect(response.status).toBe(200);
    expect(await getDb().select().from(users)).toHaveLength(1);
    expect(saveCarQuoteFor).not.toHaveBeenCalled();
    expect(await getDb().select().from(customers)).toHaveLength(0);
    expect(await getDb().select().from(quotes)).toHaveLength(0);
  });

  it("makes the user, but no customer or quote, when the journey fails the checks", async () => {
    const response = await signUpWithQuote({ vehicle: { registration: "NOPE" } });
    expect(response.status).toBe(200);
    await expect(vi.mocked(saveCarQuoteFor).mock.results[0]!.value).resolves.toMatchObject({
      status: "invalid",
    });
    expect(await userByEmail()).toBeDefined();
    expect(await getDb().select().from(customers)).toHaveLength(0);
    expect(await getDb().select().from(quotes)).toHaveLength(0);
  });

  it("still answers ok, with the user made, when the save throws, and logs no journey", async () => {
    vi.mocked(saveCarQuoteFor).mockRejectedValueOnce(new Error("Alex Morgan 1991-05-12"));
    const response = await signUpWithQuote(await golf());
    expect(response.status).toBe(200);
    expect(await userByEmail()).toBeDefined();
    expect(await getDb().select().from(quotes)).toHaveLength(0);
    expect(errorLog).toHaveBeenCalledWith("[auth] sign-up quote save error:", { name: "Error" });
    expect(JSON.stringify(errorLog.mock.calls)).not.toMatch(/Morgan|1991/);
  });

  it("still answers ok, with the user made, when the quote save is rate limited", async () => {
    const key = `quote.save:${await rateLimitSubject(null, requestHeaders(), SECRET)}`;
    const windowStart = new Date(
      Math.floor(Date.now() / 1000 / QUOTE_SAVE_RULE.windowSeconds) *
        QUOTE_SAVE_RULE.windowSeconds *
        1000,
    );
    await getDb()
      .insert(rateLimits)
      .values({ key, windowStart, count: QUOTE_SAVE_RULE.max + 5 });

    const response = await signUpWithQuote(await golf());
    expect(response.status).toBe(200);
    expect(await userByEmail()).toBeDefined();
    expect(await getDb().select().from(quotes)).toHaveLength(0);
    expect(saveCarQuoteFor).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("[auth] sign-up quote save error:", {
      name: "RateLimitError",
    });
  });

  it("answers before the quote is saved, so a new email takes no longer than a taken one (4.4b)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = vi.mocked(saveCarQuoteFor).getMockImplementation()!;
    vi.mocked(saveCarQuoteFor).mockImplementationOnce(async (...args) => {
      await gate;
      return real(...args);
    });
    const held: Promise<unknown>[] = [];
    const auth = makeAuth({ defer: (work) => void held.push(work) });

    const request = post(auth, "/sign-up/email", {
      name: "Maya Patel",
      email: EMAIL,
      password: PASSWORD,
      acceptTerms: true,
      callbackURL: "/email-confirmed",
      quote: { journey: await golf() },
    });
    // A save inside the response would hold it until the gate opens: give up after 3 seconds
    const answered = await Promise.race([
      request,
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3000)),
    ]);
    const beforeRelease = await getDb().select().from(quotes);
    release();
    const response = await request;
    await Promise.all(held);
    expect(answered).not.toBe("blocked");
    expect(response.status).toBe(200);
    expect(beforeRelease).toHaveLength(0);
    expect(await getDb().select().from(quotes)).toHaveLength(1);
  });

  it("saves nothing for a sign-up without a quote", async () => {
    await signUp(makeAuth());
    expect(saveCarQuoteFor).not.toHaveBeenCalled();
    expect(await getDb().select().from(customers)).toHaveLength(0);
  });
});
