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

import { composeBundle } from "#/features/quote/bundle";
import { completeHomeJourney, completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { resolveActor } from "#/server/auth/actor";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { priorClaims, properties, quoteItems, quotes, vehicles } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeUser } from "#/test/factories";

import { checkCarJourney } from "./car-check";
import { checkHomeJourney } from "./home-check";
import { coverPrices } from "./price";
import { saveBundleQuote, saveBundleQuoteFor } from "./save";

// Saving a car + home bundle (5.7b, decision 6): both journeys checked and priced again together,
// one quote with two items and the bundle saving, one customer from car's main driver, and
// nothing saved when either half isn't quoted or the two policyholders differ.

const NOW = new Date("2026-11-11T12:00:00Z");
const ctx = { headers: new Headers() };

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  journey.cover = {
    coverLevel: "comprehensive",
    voluntaryExcessPence: 0,
    addons: ["breakdown_uk"],
  };
  return journey;
}

/** Car's main driver as the home's policyholder, with an extra on the home */
function home(): Journey {
  const journey = completeHomeJourney();
  journey.homeAbout = { firstName: "Alex", lastName: "Morgan", dateOfBirth: "1991-05-12" };
  journey.cover = {
    coverLevel: "comprehensive",
    voluntaryExcessPence: 0,
    addons: ["home_emergency"],
  };
  return journey;
}

const save = (userId: string, car: unknown, homeJourney: unknown) =>
  withTx(getDb(), (tx) => saveBundleQuoteFor(tx, userId, { car, home: homeJourney, now: NOW }));

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

describe("saveBundleQuoteFor", () => {
  it("saves one quote with a car and a home item and the bundle saving", async () => {
    const user = await makeUser();
    expect(await save(user.id, await golf(), home())).toMatchObject({ status: "saved" });

    const [quote] = await getDb().select().from(quotes);
    expect(quote!.bundleDiscountPence).toBeGreaterThan(0);
    expect(quote!.postcode).toBe("E8 3RL");
    const items = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quote!.id));
    expect(items.map((i) => i.product).sort()).toEqual(["car", "home"]);
    expect(await getDb().select().from(vehicles)).toHaveLength(1);
    expect(await getDb().select().from(properties)).toHaveLength(1);
    // Car's incident is kept too (5.7c)
    const claims = await getDb().select().from(priorClaims);
    expect(claims.map((c) => [c.product, c.type]).sort()).toEqual([
      ["car", "collision"],
      ["home", "escape_of_water"],
    ]);
  });

  it("stores what screen 22's panel shows for the same choice", async () => {
    const user = await makeUser();
    const car = await golf();
    const homeJourney = home();
    await save(user.id, car, homeJourney);
    const [quote] = await getDb().select().from(quotes);

    const carChecked = await checkCarJourney({ journey: car, voluntaryExcessPence: 0 }, NOW);
    const homeChecked = await checkHomeJourney(
      { journey: homeJourney, voluntaryExcessPence: 0 },
      NOW,
    );
    if (!carChecked.ok || !homeChecked.ok) throw new Error("the fixtures don't pass");
    const carPrices = coverPrices("car", carChecked.inputs, carChecked.tables);
    const homePrices = coverPrices("home", homeChecked.inputs, homeChecked.tables);
    if (carPrices.status !== "quoted" || homePrices.status !== "quoted") {
      throw new Error("the fixtures aren't quoted");
    }
    const money = composeBundle(
      { prices: carPrices, cover: car.cover! },
      { prices: homePrices, cover: homeJourney.cover! },
    )!;
    expect(quote!.totalPence).toBe(money.totalPence);
    expect(quote!.bundleDiscountPence).toBe(money.savingPence);
  });

  it("saves nothing and says so when the home is declined", async () => {
    const user = await makeUser();
    const declined = home();
    declined.property!.rebuildCostPounds = 2_500_000;
    expect(await save(user.id, await golf(), declined)).toEqual({
      status: "not_quoted",
      product: "home",
      outcome: "declined",
    });
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("saves nothing and says so when the home is referred", async () => {
    const user = await makeUser();
    const referred = home();
    referred.property!.rebuildCostPounds = 1_000_000;
    expect(await save(user.id, await golf(), referred)).toEqual({
      status: "not_quoted",
      product: "home",
      outcome: "referred",
    });
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("refuses two different policyholders", async () => {
    const user = await makeUser();
    const other = home();
    other.homeAbout = { ...other.homeAbout!, dateOfBirth: "1991-05-13" };
    expect(await save(user.id, await golf(), other)).toEqual({ status: "mismatch" });
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("matches names trimmed and case-blind", async () => {
    const user = await makeUser();
    const typed = home();
    typed.homeAbout = { ...typed.homeAbout!, firstName: " alex " };
    expect(await save(user.id, await golf(), typed)).toMatchObject({ status: "saved" });
  });

  it("sends an unfinished car back to its step", async () => {
    const user = await makeUser();
    const { vehicle: _vehicle, ...car } = await golf();
    expect(await save(user.id, car, home())).toEqual({
      status: "invalid",
      product: "car",
      step: "car",
    });
  });

  it("saves once for one idempotency key", async () => {
    const user = await makeUser();
    const actor = (await resolveActor(getDb(), user.id))!;
    const envelope = { input: { car: await golf(), home: home() }, idempotencyKey: randomUUID() };
    const first = await saveBundleQuote(actor, envelope, ctx);
    const second = await saveBundleQuote(actor, envelope, ctx);
    expect(first).toMatchObject({ ok: true, data: { status: "saved" } });
    expect(second).toEqual(first);
    expect(await getDb().select().from(quotes)).toHaveLength(1);
  });
});
