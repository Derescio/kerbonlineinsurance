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

import { composeCover } from "#/features/quote/cover";
import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { resolveActor } from "#/server/auth/actor";
import { RateLimitError } from "#/server/auth/errors";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  customers,
  quoteItemAddons,
  quoteItemOptions,
  quoteItems,
  quotes,
  vehicleCatalogue,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeStaff, makeUser } from "#/test/factories";

import { priceCarJourney } from "./price";
import { saveCarQuote, saveCarQuoteFor } from "./save";

// Saving a car quote on the server (5.6, decisions 4 and 5): the journey is checked and priced
// again with the chosen cover, the customer row is made at the first save, and a declined quote
// or a staff user saves nothing.

// The fixture's dates hold on 11 Nov 2026
const NOW = new Date("2026-11-11T12:00:00Z");
const ctx = { headers: new Headers() };

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

const save = (userId: string, journey: unknown) =>
  withTx(getDb(), (tx) => saveCarQuoteFor(tx, userId, { journey, now: NOW }));

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  // rateLimitSubject reads its secret from the whole auth env, which this project doesn't set
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
  // limit() warns on a refusal
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // The reference data is loaded once (beforeAll); each test clears only what it writes
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("saveCarQuoteFor", () => {
  it("makes the customer from About you at the first save, and keeps it unchanged after", async () => {
    const user = await makeUser();
    const first = await save(user.id, await golf());
    expect(first).toMatchObject({ status: "saved", outcome: "quoted" });
    const rows = await getDb().select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      firstName: "Alex",
      lastName: "Morgan",
      dateOfBirth: "1991-05-12",
      addressLine1: "18 Albion Road",
      addressLine2: null,
      town: "London",
      postcode: "E8 3RL",
      phone: null,
    });

    const moved = await golf();
    moved.mainDriver = { ...moved.mainDriver!, addressLine1: "2 New Street", town: "Hackney" };
    const second = await save(user.id, moved);
    expect(second).toMatchObject({ status: "saved" });
    expect(await getDb().select().from(customers)).toEqual(rows);
    const saved = await getDb().select().from(quotes);
    expect(saved).toHaveLength(2);
    expect(saved.every((q) => q.customerId === rows[0]!.id)).toBe(true);
  });

  it("prices the chosen cover again on the server, ignoring any price sent", async () => {
    const user = await makeUser();
    const journey = await golf();
    journey.cover = {
      coverLevel: "plus",
      voluntaryExcessPence: 25_000,
      addons: ["breakdown_uk"],
    };
    const result = await save(user.id, journey);
    if (result.status !== "saved") throw new Error(`not saved: ${result.status}`);

    const prices = await priceCarJourney(
      { journey, voluntaryExcessPence: 25_000 },
      new Headers({ "x-forwarded-for": "203.0.113.9" }),
      NOW,
      SECRET,
    );
    if (prices.status !== "quoted") throw new Error("not quoted");
    const browser = composeCover(prices, "plus", ["breakdown_uk"])!;
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, result.quoteId));
    expect(quote).toMatchObject({ status: "priced", totalPence: browser.totalPence });

    const [item] = await getDb()
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, result.quoteId));
    // Cover starts tomorrow (London) until Confirm and pay sets it (decision 8)
    expect(item).toMatchObject({ voluntaryExcessPence: 25_000, startDate: "2026-11-12" });
    const [option] = await getDb()
      .select()
      .from(quoteItemOptions)
      .where(eq(quoteItemOptions.id, item!.selectedOptionId!));
    expect(option!.coverLevel).toBe("plus");
    const addons = await getDb()
      .select()
      .from(quoteItemAddons)
      .where(eq(quoteItemAddons.quoteItemId, item!.id));
    expect(addons.filter((a) => a.selected).map((a) => a.addon)).toEqual(["breakdown_uk"]);

    // A price anywhere in the request changes nothing
    const tampered = {
      ...journey,
      price: 1,
      totalPence: 1,
      cover: { ...journey.cover, price: 1, premiumPence: 1 },
      vehicle: { ...journey.vehicle, price: 1, valuePence: 1, insuranceGroup: 1 },
    };
    const again = await save(user.id, tampered);
    if (again.status !== "saved") throw new Error(`not saved: ${again.status}`);
    const [second] = await getDb().select().from(quotes).where(eq(quotes.id, again.quoteId));
    expect(second!.totalPence).toBe(browser.totalPence);
  });

  it("sends a withdrawn car back to the car step and writes nothing", async () => {
    const user = await makeUser();
    const journey = await golf();
    const golfRow = eq(vehicleCatalogue.id, journey.vehicle!.catalogueVariantId);
    await getOwnerDb().update(vehicleCatalogue).set({ isActive: false }).where(golfRow);
    clearReferenceCaches();
    try {
      await expect(save(user.id, journey)).resolves.toEqual({ status: "invalid", step: "car" });
    } finally {
      // The catalogue is shared by the file's tests
      await getOwnerDb().update(vehicleCatalogue).set({ isActive: true }).where(golfRow);
      clearReferenceCaches();
    }
    expect(await getDb().select().from(quotes)).toEqual([]);
    expect(await getDb().select().from(customers)).toEqual([]);
  });

  it("refuses a voluntary excess that isn't offered", async () => {
    const user = await makeUser();
    const journey = await golf();
    journey.cover = { coverLevel: "comprehensive", voluntaryExcessPence: 30_000, addons: [] };
    await expect(save(user.id, journey)).resolves.toEqual({ status: "invalid", step: "cover" });
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("saves a referred quote for review", async () => {
    const user = await makeUser();
    const journey = await golf();
    journey.claims!.incidents = [1, 2, 3].map((n) => ({
      ...journey.claims!.incidents[0]!,
      id: `i${n}`,
    }));
    const result = await save(user.id, journey);
    expect(result).toMatchObject({ status: "saved", outcome: "referred" });
    if (result.status !== "saved") return;
    expect(result.reference).toMatch(/^KRB-Q-\d{5}$/);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, result.quoteId));
    expect(quote!.status).toBe("referred");
  });

  it("saves nothing for a declined quote", async () => {
    const user = await makeUser();
    // The Isle of Man is a Crown dependency: Kerb doesn't cover it
    const journey = { ...(await golf()), postcode: "IM1 1AE" };
    await expect(save(user.id, journey)).resolves.toEqual({ status: "declined" });
    expect(await getDb().select().from(quotes)).toEqual([]);
    expect(await getDb().select().from(customers)).toEqual([]);
  });

  it("refuses staff, with no customer row", async () => {
    const staff = await makeStaff();
    await expect(save(staff.userId, await golf())).resolves.toEqual({ status: "staff" });
    expect(await getDb().select().from(customers)).toEqual([]);
    expect(await getDb().select().from(quotes)).toEqual([]);
  });
});

describe("saveCarQuote", () => {
  it("saves once for one key, however often it's sent", async () => {
    const user = await makeUser();
    const actor = (await resolveActor(getDb(), user.id))!;
    const envelope = { input: { journey: await golf() }, idempotencyKey: randomUUID() };
    const first = await saveCarQuote(actor, envelope, ctx);
    const second = await saveCarQuote(actor, envelope, ctx);
    expect(first).toMatchObject({ ok: true, data: { status: "saved" } });
    expect(second).toEqual(first);
    expect(await getDb().select().from(quotes)).toHaveLength(1);
  });

  it("rejects a staff user", async () => {
    const staff = await makeStaff();
    const actor = (await resolveActor(getDb(), staff.userId))!;
    const result = await saveCarQuote(
      { ...actor, twoFactor: { enabled: true, verifiedAt: NOW } },
      { input: { journey: await golf() }, idempotencyKey: randomUUID() },
      ctx,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { message: "Staff accounts can't buy policies." },
    });
    expect(await getDb().select().from(customers)).toEqual([]);
  });

  it("allows 20 saves an hour", async () => {
    const user = await makeUser();
    const actor = (await resolveActor(getDb(), user.id))!;
    const send = () =>
      saveCarQuote(actor, { input: { journey: null }, idempotencyKey: randomUUID() }, ctx);
    for (let i = 0; i < 20; i++) {
      await expect(send()).resolves.toMatchObject({
        ok: true,
        data: { status: "invalid", step: "car" },
      });
    }
    await expect(send()).rejects.toBeInstanceOf(RateLimitError);
  });
});
