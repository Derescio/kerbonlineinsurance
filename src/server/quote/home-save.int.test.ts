import { randomUUID } from "node:crypto";

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

import { completeHomeJourney } from "#/features/quote/journey-fixtures";
import { resolveActor } from "#/server/auth/actor";
import { clearReferenceCaches, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  customers,
  priorClaims,
  properties,
  quoteItemFactors,
  quoteItems,
  quotes,
  ratingVersions,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeUser } from "#/test/factories";

import { saveHomeQuote, saveHomeQuoteFor } from "./save";

// Saving a home quote (5.7, decision 9): checked and priced again, the customer made from About you
// and the insured address, every answer stored, and a declined quote not saved.

const NOW = new Date("2026-11-11T12:00:00Z");
const ctx = { headers: new Headers() };

const save = (userId: string, journey: unknown) =>
  withTx(getDb(), (tx) => saveHomeQuoteFor(tx, userId, { journey, now: NOW }));

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kerb <hello@example.com>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("saveHomeQuoteFor", () => {
  it("makes the customer from About you and the insured address, and stores every answer", async () => {
    const user = await makeUser();
    const result = await save(user.id, completeHomeJourney());
    expect(result).toMatchObject({ status: "saved", outcome: "quoted" });

    expect(await getDb().select().from(customers)).toEqual([
      expect.objectContaining({
        userId: user.id,
        firstName: "Priya",
        lastName: "Shah",
        dateOfBirth: "1988-03-02",
        addressLine1: "18 Albion Road",
        town: "Hackney",
        postcode: "E8 3RL",
      }),
    ]);
    const [item] = await getDb().select().from(quoteItems);
    expect(item).toMatchObject({ product: "home", outcome: "quoted" });
    const [property] = await getDb()
      .select()
      .from(properties)
      .where(eq(properties.quoteItemId, item!.id));
    expect(property).toMatchObject({
      addressLine1: "18 Albion Road",
      rebuildCostPence: 25_000_000,
      valuablesPence: 500_000,
      windowLocks: "all_accessible",
      alarmType: "installed_unmonitored",
      hasAlarm: true,
      pastClaims: 1,
      employmentStatus: "employed",
      occupation: "teacher",
    });
    expect(await getDb().select().from(priorClaims)).toEqual([
      expect.objectContaining({
        product: "home",
        type: "escape_of_water",
        amountPence: 95_000,
        status: "settled",
        fault: null,
      }),
    ]);
  });

  it("prices a new home quote with home v2, the policyholder's occupation included (5.7c)", async () => {
    const user = await makeUser();
    await save(user.id, completeHomeJourney());
    const [item] = await getDb().select().from(quoteItems);
    const [version] = await getDb()
      .select()
      .from(ratingVersions)
      .where(eq(ratingVersions.id, item!.ratingVersionId));
    expect(version).toMatchObject({ product: "home", version: 2 });
    expect(await getDb().select().from(quoteItemFactors)).toContainEqual(
      expect.objectContaining({ factor: "occupation_band", inputValue: "B" }),
    );
  });

  it("saves a referred quote", async () => {
    const user = await makeUser();
    const journey = completeHomeJourney();
    journey.property!.rebuildCostPounds = 1_000_000;
    expect(await save(user.id, journey)).toMatchObject({ status: "saved", outcome: "referred" });
    expect(await getDb().select().from(quotes)).toEqual([
      expect.objectContaining({ status: "referred" }),
    ]);
  });

  it("doesn't save a declined quote", async () => {
    const user = await makeUser();
    const journey = completeHomeJourney();
    journey.property!.rebuildCostPounds = 2_500_000;
    expect(await save(user.id, journey)).toEqual({ status: "declined" });
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("sends an unfinished journey back to its step", async () => {
    const user = await makeUser();
    const { homeClaims: _c, ...journey } = completeHomeJourney();
    expect(await save(user.id, journey)).toEqual({ status: "invalid", step: "claims" });
  });

  it("saves once for one idempotency key", async () => {
    const user = await makeUser();
    const actor = (await resolveActor(getDb(), user.id))!;
    const envelope = { input: { journey: completeHomeJourney() }, idempotencyKey: randomUUID() };
    const first = await saveHomeQuote(actor, envelope, ctx);
    const second = await saveHomeQuote(actor, envelope, ctx);
    expect(first).toMatchObject({ ok: true, data: { status: "saved" } });
    expect(second).toEqual(first);
    expect(await getDb().select().from(quotes)).toHaveLength(1);
  });
});
