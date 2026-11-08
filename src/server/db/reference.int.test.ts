import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import {
  deletedRows,
  ratingAddons,
  ratingFactors,
  ratingLookups,
  ratingParameters,
  ratingTiers,
  ratingVersions,
  vehicleCatalogue,
  vehicles,
} from "#/server/db/schema";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeQuote, makeRatingVersion } from "#/test/factories";

// 4.8 (plan/phases/04-data-auth/08-reference-data.md, call 18): the reference tables are written
// by the deploy as the owner and only read by the app, so kerb_app can't change them.

const PERMISSION = "42501";
const CHECK = "23514";
const RESTRICTED = "23001";

async function expectRefused(query: PromiseLike<unknown>, code: string) {
  const error = await Promise.resolve(query).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error, "Postgres accepted the statement").toBeDefined();
  const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: string };
  expect(pg.code).toBe(code);
}

const catalogueRow = {
  make: "Ford",
  model: "Fiesta",
  year: 2018,
  variant: "1.1 Zetec 5dr",
  bodyStyle: "hatchback",
  fuelType: "petrol",
  transmission: "manual",
  doors: 5,
  engineCc: 1084,
  powerBhp: 85,
  insuranceGroup: 6,
  valuePence: 640_000,
} as const;

async function seedOneOfEach() {
  const owner = getOwnerDb();
  const version = await makeRatingVersion();
  const ratingVersionId = version.id;
  const [catalogue] = await owner.insert(vehicleCatalogue).values(catalogueRow).returning();
  await owner.insert(ratingParameters).values({ ratingVersionId, name: "ipt_rate", value: "0.12" });
  await owner
    .insert(ratingTiers)
    .values({ ratingVersionId, coverLevel: "plus", multiplier: "1.18", compulsoryExcessPence: 0 });
  await owner
    .insert(ratingAddons)
    .values({ ratingVersionId, addon: "motor_legal", annualPricePence: 2_500 });
  await owner.insert(ratingFactors).values({
    ratingVersionId,
    factor: "driver_age",
    band: "17-18",
    rangeFrom: 17,
    rangeTo: 18,
    multiplier: "2.4",
  });
  await owner.insert(ratingLookups).values({
    ratingVersionId,
    lookup: "postcode_area",
    factor: "postcode_band",
    key: "LS",
    label: "Leeds",
    band: "5",
  });
  return { ratingVersionId, catalogueId: catalogue!.id };
}

describe("reference tables", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("refuses kerb_app writes on every reference table", async () => {
    const { ratingVersionId } = await seedOneOfEach();
    const db = getDb();

    await expectRefused(
      db.insert(vehicleCatalogue).values({ ...catalogueRow, variant: "1.0 EcoBoost" }),
      PERMISSION,
    );
    await expectRefused(
      db.insert(ratingParameters).values({ ratingVersionId, name: "fee_pence", value: "0" }),
      PERMISSION,
    );
    await expectRefused(
      db.insert(ratingTiers).values({
        ratingVersionId,
        coverLevel: "essential",
        multiplier: "1",
        compulsoryExcessPence: 0,
      }),
      PERMISSION,
    );
    await expectRefused(
      db
        .insert(ratingAddons)
        .values({ ratingVersionId, addon: "breakdown_uk", annualPricePence: 1 }),
      PERMISSION,
    );
    await expectRefused(
      db
        .insert(ratingFactors)
        .values({ ratingVersionId, factor: "usage", band: "social", multiplier: "1" }),
      PERMISSION,
    );
    await expectRefused(
      db.insert(ratingLookups).values({
        ratingVersionId,
        lookup: "occupation",
        factor: "occupation_band",
        key: "teacher",
        label: "Teacher",
        band: "B",
      }),
      PERMISSION,
    );

    const tables = [
      vehicleCatalogue,
      ratingParameters,
      ratingTiers,
      ratingAddons,
      ratingFactors,
      ratingLookups,
    ] as const;
    for (const table of tables) {
      expect(await db.select().from(table)).toHaveLength(1);
      await expectRefused(db.update(table).set({ createdAt: new Date() }), PERMISSION);
      await expectRefused(db.delete(table), PERMISSION);
    }
  });

  it("refuses deleting a catalogue row a vehicle points at", async () => {
    const { catalogueId } = await seedOneOfEach();
    const { items } = await makeQuote({ products: ["car"] });
    const owner = getOwnerDb();
    await owner
      .update(vehicles)
      .set({ catalogueVariantId: catalogueId })
      .where(eq(vehicles.quoteItemId, items[0]!.item.id));

    await expectRefused(
      owner.delete(vehicleCatalogue).where(eq(vehicleCatalogue.id, catalogueId)),
      RESTRICTED,
    );
  });

  it("refuses a multiplier of 0 and a range_to below range_from", async () => {
    const { id: ratingVersionId } = await makeRatingVersion();
    const owner = getOwnerDb();

    await expectRefused(
      owner
        .insert(ratingFactors)
        .values({ ratingVersionId, factor: "usage", band: "social", multiplier: "0" }),
      CHECK,
    );
    await expectRefused(
      owner.insert(ratingFactors).values({
        ratingVersionId,
        factor: "driver_age",
        band: "bad",
        rangeFrom: 25,
        rangeTo: 24,
        multiplier: "1",
      }),
      CHECK,
    );
  });

  it("records deletes of rating rows in deleted_rows", async () => {
    const { ratingVersionId } = await seedOneOfEach();
    const owner = getOwnerDb();

    await owner.delete(ratingVersions).where(eq(ratingVersions.id, ratingVersionId));

    const tombstones = await owner
      .select({ count: sql<number>`count(*)::int` })
      .from(deletedRows)
      .where(eq(deletedRows.tableName, "rating_factors"));
    expect(tombstones[0]!.count).toBe(1);
  });
});
