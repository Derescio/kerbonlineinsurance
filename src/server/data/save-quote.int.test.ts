import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { carInputs, homeInputs } from "#/features/rating/test-tables";
import { priceQuote, type QuoteItemRequest } from "#/features/rating/price-quote";
import { clearReferenceCaches, getActiveRatingTables, upsertReferenceData } from "./reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  drivers,
  properties,
  quoteItemAddons,
  quoteItemFactors,
  quoteItemOptions,
  quoteItems,
  quotes,
  ratingVersions,
  underwritingDecisions,
  vehicles,
} from "#/server/db/schema";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer } from "#/test/factories";

import type { CarDetails, HomeDetails, SaveItem } from "./quote-rows";
import { saveQuote } from "./save-quote";
import { makeQuote } from "#/test/factories";

// saveQuote() (5.4, spec decision 2): built and tested here, called by 5.6 after sign-in. One
// transaction writes the quote, its items, options, add-ons, factor lines, detail rows and first
// decisions; reading it later never re-prices it.

const NOW = new Date("2026-11-11T12:00:00Z");

const carDetails = (named = 1): CarDetails => ({
  product: "car",
  vehicle: {
    make: "Volkswagen",
    model: "Golf",
    year: 2020,
    variant: "1.0 TSI Life 5dr",
    fuelType: "petrol",
    doors: 5,
    insuranceGroup: 14,
    valuePence: 2_000_000,
    catalogueVariantId: null,
    registration: "VW21 GQL",
    currentMileage: 18_200,
    annualMileage: 8_000,
    usage: "commuting",
    overnightLocation: "driveway",
  },
  drivers: [
    {
      firstName: "Alex",
      lastName: "Morgan",
      dateOfBirth: "1996-05-12",
      occupation: "teacher",
      licenceYears: 10,
      noClaimsYears: 5,
      pastClaims: 0,
    },
    ...Array.from({ length: named }, () => ({
      firstName: "Sam",
      lastName: "Morgan",
      dateOfBirth: "2007-05-01",
      occupation: "student",
      licenceYears: 1,
      noClaimsYears: 0,
      pastClaims: 0,
    })),
  ],
});

/** The details priced as a group 32 car with one 19-year-old named driver */
function teslaDetails(): CarDetails {
  const details = carDetails(1);
  details.vehicle.insuranceGroup = 32;
  return details;
}

const homeDetails = (): HomeDetails => ({
  product: "home",
  property: {
    addressLine1: "18 Albion Road",
    town: "Leeds",
    postcode: "LS6 2AB",
    propertyType: "semi",
    yearBuilt: 1990,
    bedrooms: 3,
    rebuildCostPence: 24_000_000,
    contentsValuePence: 4_500_000,
    hasAlarm: false,
    hasSmokeAlarm: true,
    lockType: "multipoint",
    pastClaims: 0,
  },
});

async function priced(requests: Omit<QuoteItemRequest, "tables">[]) {
  return priceQuote(
    await Promise.all(
      requests.map(
        async (r) => ({ ...r, tables: await getActiveRatingTables(r.product) }) as QuoteItemRequest,
      ),
    ),
  );
}

const save = (item: SaveItem["details"]): SaveItem => ({
  startDate: "2026-11-20",
  voluntaryExcessPence: 0,
  details: item,
});

describe("saveQuote", () => {
  beforeAll(async () => {
    await truncateAll();
    clearReferenceCaches();
    await upsertReferenceData(getOwnerDb(), {
      rating: structuredClone(RATING_SOURCES),
      catalogue: structuredClone(CATALOGUE_SOURCES),
    });
  });
  beforeEach(async () => {
    // The reference data is loaded once (beforeAll); each test clears only what it writes
    await truncateExcept(REFERENCE_TABLES);
    clearReferenceCaches();
  });
  afterAll(closeDb);

  it("saves a car and home bundle with every row and its totals", async () => {
    const customer = await makeCustomer();
    const quote = await priced([
      {
        product: "car",
        inputs: carInputs({ namedDrivers: [{ age: 30, licenceYears: 10 }] }),
        coverLevel: "comprehensive",
        addons: [],
      },
      { product: "home", inputs: homeInputs(), coverLevel: "comprehensive", addons: [] },
    ]);
    const saved = await saveQuote(getDb(), {
      customerId: customer.id,
      postcode: "LS6 2AB",
      priced: quote,
      items: [save(carDetails()), save(homeDetails())],
      now: NOW,
    });

    expect(saved.reference).toMatch(/^KRB-Q-[1-8][0-9]{4}$/);
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    expect(row).toMatchObject({
      status: "priced",
      subtotalPence: quote.subtotalPence,
      bundleDiscountPence: quote.bundleDiscountPence,
      feesPence: 0,
      iptPence: quote.iptPence,
      totalPence: quote.totalPence,
    });
    expect(quote.bundleDiscountPence).toBeGreaterThan(0);
    // valid_until is 30 days on
    expect(row!.validUntil.toISOString()).toBe("2026-12-11T12:00:00.000Z");

    const items = await getDb()
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, saved.quoteId));
    expect(items).toHaveLength(2);
    const car = await getActiveRatingTables("car");
    for (const item of items) {
      const options = await getDb()
        .select()
        .from(quoteItemOptions)
        .where(eq(quoteItemOptions.quoteItemId, item.id));
      expect(options).toHaveLength(3);
      // Comprehensive is selected
      expect(options.find((o) => o.id === item.selectedOptionId)?.coverLevel).toBe("comprehensive");
      expect(
        await getDb()
          .select()
          .from(quoteItemFactors)
          .where(eq(quoteItemFactors.quoteItemId, item.id)),
      ).not.toHaveLength(0);
      expect(
        await getDb()
          .select()
          .from(underwritingDecisions)
          .where(eq(underwritingDecisions.quoteItemId, item.id)),
      ).toHaveLength(1);
      if (item.product === "car") expect(item.ratingVersionId).toBe(car.id);
    }
    const carItem = items.find((i) => i.product === "car")!;
    expect(
      await getDb().select().from(vehicles).where(eq(vehicles.quoteItemId, carItem.id)),
    ).toHaveLength(1);
    const savedDrivers = await getDb()
      .select()
      .from(drivers)
      .where(eq(drivers.quoteItemId, carItem.id));
    expect(savedDrivers.map((d) => [d.firstName, d.isMain])).toEqual(
      expect.arrayContaining([
        ["Alex", true],
        ["Sam", false],
      ]),
    );
    const homeItem = items.find((i) => i.product === "home")!;
    expect(
      await getDb().select().from(properties).where(eq(properties.quoteItemId, homeItem.id)),
    ).toHaveLength(1);
    // Every add-on offered is saved, none selected
    const addons = await getDb()
      .select()
      .from(quoteItemAddons)
      .where(eq(quoteItemAddons.quoteItemId, carItem.id));
    expect(addons.length).toBeGreaterThan(0);
    expect(addons.every((a) => !a.selected)).toBe(true);
  });

  it("notes the named driver a decline was about", async () => {
    const customer = await makeCustomer();
    const tesla = carInputs({
      vehicle: { ...carInputs().vehicle, insuranceGroup: 32 },
      namedDrivers: [{ age: 19, licenceYears: 1 }],
    });
    const quote = await priced([
      { product: "car", inputs: tesla, coverLevel: "comprehensive", addons: [] },
    ]);
    const saved = await saveQuote(getDb(), {
      customerId: customer.id,
      postcode: "LS6 2AB",
      priced: quote,
      items: [save(teslaDetails())],
      now: NOW,
    });
    const [item] = await getDb()
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, saved.quoteId));
    expect(item).toMatchObject({
      outcome: "declined",
      reasonCode: "young_driver_high_group",
      selectedOptionId: null,
    });
    const [decision] = await getDb()
      .select()
      .from(underwritingDecisions)
      .where(eq(underwritingDecisions.quoteItemId, item!.id));
    expect(decision).toMatchObject({
      outcome: "declined",
      note: "named driver 1",
      decidedBy: null,
    });
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    expect(row).toMatchObject({ status: "declined", totalPence: 0 });
  });

  it("writes nothing when a row fails part-way", async () => {
    const customer = await makeCustomer();
    const quote = await priced([
      { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
    ]);
    // 9 doors breaks vehicles_doors_check after the quote and item are written
    const bad = carDetails(0);
    bad.vehicle.doors = 9;
    await expect(
      saveQuote(getDb(), {
        customerId: customer.id,
        postcode: "LS6 2AB",
        priced: quote,
        items: [save(bad)],
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(await getDb().select().from(quotes)).toEqual([]);
    expect(await getDb().select().from(quoteItems)).toEqual([]);
    expect(await getDb().select().from(underwritingDecisions)).toEqual([]);
  });

  it("keeps the old price after a new version is activated", async () => {
    const customer = await makeCustomer();
    const quote = await priced([
      { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
    ]);
    const saved = await saveQuote(getDb(), {
      customerId: customer.id,
      postcode: "LS6 2AB",
      priced: quote,
      items: [save(carDetails(0))],
      now: NOW,
    });
    const v1 = (await getActiveRatingTables("car")).id;

    // Car v2: every price doubled, activated by the deploy
    const carV1 = RATING_SOURCES.find((s) => s.product === "car")!;
    const v2 = {
      ...structuredClone(carV1),
      version: 2,
      effectiveFrom: "2026-11-12",
      notes: "test v2",
      parameters: { ...carV1.parameters, base_rate_pence: carV1.parameters.base_rate_pence! * 2 },
    };
    clearReferenceCaches();
    await upsertReferenceData(getOwnerDb(), {
      rating: [...structuredClone(RATING_SOURCES), v2],
      catalogue: structuredClone(CATALOGUE_SOURCES),
    });
    expect((await getActiveRatingTables("car")).id).not.toBe(v1);

    const [item] = await getDb()
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, saved.quoteId));
    expect(item!.ratingVersionId).toBe(v1);
    const [option] = await getDb()
      .select()
      .from(quoteItemOptions)
      .where(eq(quoteItemOptions.id, item!.selectedOptionId!));
    expect(option!.annualPremiumPence).toBe(quote.items[0]!.selected!.premiumPence);
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    expect(row!.totalPence).toBe(quote.totalPence);
    expect(await getDb().select().from(ratingVersions)).toHaveLength(4);
  });

  it("keeps named drivers in the order entered, so 'named driver n' finds the right row", async () => {
    const customer = await makeCustomer();
    const three = [30, 40, 50].map((age) => ({ age, licenceYears: 10 }));
    const quote = await priced([
      {
        product: "car",
        inputs: carInputs({ namedDrivers: three }),
        coverLevel: "comprehensive",
        addons: [],
      },
    ]);
    const details = carDetails(0);
    details.drivers.push(
      ...["First", "Second", "Third"].map((firstName) => ({ ...details.drivers[0]!, firstName })),
    );
    const saved = await saveQuote(getDb(), {
      customerId: customer.id,
      postcode: "LS6 2AB",
      priced: quote,
      items: [save(details)],
      now: NOW,
    });
    const [item] = await getDb()
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, saved.quoteId));
    const named = (await getDb().select().from(drivers).where(eq(drivers.quoteItemId, item!.id)))
      .filter((d) => !d.isMain)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((d) => d.firstName);
    expect(named).toEqual(["First", "Second", "Third"]);
  });

  it("refuses details that don't match what was priced", async () => {
    const customer = await makeCustomer();
    const quote = await priced([
      {
        product: "car",
        inputs: carInputs({ namedDrivers: [{ age: 30, licenceYears: 10 }] }),
        coverLevel: "comprehensive",
        addons: [],
      },
    ]);
    const input = { customerId: customer.id, postcode: "LS6 2AB", priced: quote, now: NOW };
    // No named driver saved for the one priced
    await expect(saveQuote(getDb(), { ...input, items: [save(carDetails(0))] })).rejects.toThrow(
      "don't match what was priced",
    );
    // A different car
    await expect(saveQuote(getDb(), { ...input, items: [save(teslaDetails())] })).rejects.toThrow(
      "don't match what was priced",
    );
    expect(await getDb().select().from(quotes)).toEqual([]);
  });

  it("draws another reference when one is taken", async () => {
    const customer = await makeCustomer();
    const { quote: taken } = await makeQuote();
    const quote = await priced([
      { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
    ]);
    const draws = [taken.reference, "KRB-Q-23456"];
    const saved = await saveQuote(
      getDb(),
      {
        customerId: customer.id,
        postcode: "LS6 2AB",
        priced: quote,
        items: [save(carDetails(0))],
        now: NOW,
      },
      { drawReference: () => draws.shift()! },
    );
    expect(saved.reference).toBe("KRB-Q-23456");
  });

  it("gives up after five taken references", async () => {
    const customer = await makeCustomer();
    const { quote: taken } = await makeQuote();
    const quote = await priced([
      { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
    ]);
    let draws = 0;
    await expect(
      saveQuote(
        getDb(),
        {
          customerId: customer.id,
          postcode: "LS6 2AB",
          priced: quote,
          items: [save(carDetails(0))],
          now: NOW,
        },
        {
          drawReference: () => {
            draws++;
            return taken.reference;
          },
        },
      ),
    ).rejects.toThrow();
    expect(draws).toBe(5);
  });
});
