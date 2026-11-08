import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import {
  ratingAddons,
  ratingFactors,
  ratingLookups,
  ratingParameters,
  ratingTiers,
  ratingVersions,
  vehicleCatalogue,
} from "#/server/db/schema";
import { expandCatalogue } from "#/server/reference/catalogue/expand";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import type { MakeSource } from "#/server/reference/catalogue/types";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import type { RatingSource } from "#/server/reference/rating/types";
import { getOwnerDb, truncateAll } from "#/test/db";

import {
  clearReferenceCaches,
  getActiveRatingVersion,
  getCatalogue,
  getRatingTables,
  ReferenceDataConflict,
  upsertReferenceData,
} from "./reference";

const owner = () => getOwnerDb();
const clone = <T>(value: T): T => structuredClone(value);
const sources = (rating = RATING_SOURCES, catalogue = CATALOGUE_SOURCES) => ({
  rating: clone(rating) as RatingSource[],
  catalogue: clone(catalogue) as MakeSource[],
});
const count = async (table: PgTable) =>
  (
    await owner()
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
  )[0]!.n;

async function catalogueRows() {
  return owner()
    .select({
      id: vehicleCatalogue.id,
      make: vehicleCatalogue.make,
      model: vehicleCatalogue.model,
      year: vehicleCatalogue.year,
      variant: vehicleCatalogue.variant,
      insuranceGroup: vehicleCatalogue.insuranceGroup,
      isActive: vehicleCatalogue.isActive,
      updatedAt: vehicleCatalogue.updatedAt,
    })
    .from(vehicleCatalogue)
    .orderBy(vehicleCatalogue.id);
}

describe("reference data", () => {
  beforeEach(async () => {
    await truncateAll();
    clearReferenceCaches();
  });
  afterAll(closeDb);

  describe("upsertReferenceData", () => {
    it("inserts v1 of each product as active, with every row", async () => {
      const result = await upsertReferenceData(owner(), sources());

      expect(result.versions).toEqual([
        { product: "car", version: 1, action: "inserted" },
        { product: "home", version: 1, action: "inserted" },
        { product: "business", version: 1, action: "inserted" },
      ]);
      const versions = await owner().select().from(ratingVersions);
      expect(versions).toHaveLength(3);
      for (const version of versions) {
        expect(version.status).toBe("active");
        expect(version.effectiveFrom).toBe("2026-11-01");
        expect(version.contentHash).toMatch(/^[0-9a-f]{64}$/);
      }
      const total = (pick: (s: RatingSource) => unknown[]) =>
        RATING_SOURCES.reduce((n, s) => n + pick(s).length, 0);
      expect(await count(ratingParameters)).toBe(
        RATING_SOURCES.reduce((n, s) => n + Object.keys(s.parameters).length, 0),
      );
      expect(await count(ratingTiers)).toBe(total((s) => s.tiers));
      expect(await count(ratingAddons)).toBe(total((s) => s.addons));
      expect(await count(ratingFactors)).toBe(total((s) => s.factors));
      expect(await count(ratingLookups)).toBe(total((s) => s.lookups));
      const expected = expandCatalogue(CATALOGUE_SOURCES).length;
      expect(await count(vehicleCatalogue)).toBe(expected);
      expect(result.catalogue).toEqual({ inserted: expected, updated: 0, deactivated: 0 });
    });

    it("changes nothing on a second run", async () => {
      await upsertReferenceData(owner(), sources());
      const before = await catalogueRows();
      const versionsBefore = await owner().select().from(ratingVersions).orderBy(ratingVersions.id);

      const result = await upsertReferenceData(owner(), sources());

      expect(result.catalogue).toEqual({ inserted: 0, updated: 0, deactivated: 0 });
      expect(result.versions.every((v) => v.action === "unchanged")).toBe(true);
      expect(await catalogueRows()).toEqual(before);
      expect(await owner().select().from(ratingVersions).orderBy(ratingVersions.id)).toEqual(
        versionsBefore,
      );
    });

    it("refuses an edited version and writes nothing", async () => {
      await upsertReferenceData(owner(), sources());
      const edited = sources();
      edited.rating[0]!.factors[0]!.multiplier = 2.5;
      const factorsBefore = await count(ratingFactors);

      await expect(upsertReferenceData(owner(), edited)).rejects.toThrow(
        new ReferenceDataConflict(
          "car v1 is already in the database with different tables; add v2 instead",
        ),
      );
      expect(await count(ratingFactors)).toBe(factorsBefore);
    });

    it("validates every source before writing", async () => {
      const broken = sources();
      broken.rating[2]!.tiers.pop();

      await expect(upsertReferenceData(owner(), broken)).rejects.toThrow(
        /business v1: tiers: expected essential, comprehensive, plus/,
      );
      expect(await count(ratingVersions)).toBe(0);
      expect(await count(vehicleCatalogue)).toBe(0);
    });

    it("updates a corrected catalogue row in place", async () => {
      await upsertReferenceData(owner(), sources());
      const [before] = await owner()
        .select()
        .from(vehicleCatalogue)
        .where(
          and(eq(vehicleCatalogue.model, "Fiesta"), eq(vehicleCatalogue.variant, "1.1 Zetec 5dr")),
        )
        .limit(1);
      const corrected = sources();
      const fiesta = corrected.catalogue[0]!.generations[1]!;
      fiesta.variants.find((v) => v.name === "1.1 Zetec 5dr")!.insuranceGroup = 4;

      const result = await upsertReferenceData(owner(), corrected);

      // The 1.1 Zetec was sold in 6 model years (2018–2023)
      expect(result.catalogue).toEqual({ inserted: 0, updated: 6, deactivated: 0 });
      const [after] = await owner()
        .select()
        .from(vehicleCatalogue)
        .where(eq(vehicleCatalogue.id, before!.id));
      expect(after!.insuranceGroup).toBe(4);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
    });

    it("deactivates a variant removed from the source, keeping its id", async () => {
      await upsertReferenceData(owner(), sources());
      const trimmed = sources();
      const fiesta = trimmed.catalogue[0]!.generations[1]!;
      fiesta.variants = fiesta.variants.filter((v) => v.name !== "ST-3 3dr");

      const result = await upsertReferenceData(owner(), trimmed);

      expect(result.catalogue).toEqual({ inserted: 0, updated: 0, deactivated: 6 });
      const st3 = await owner()
        .select()
        .from(vehicleCatalogue)
        .where(eq(vehicleCatalogue.variant, "ST-3 3dr"));
      expect(st3).toHaveLength(6);
      expect(st3.every((row) => !row.isActive)).toBe(true);
      expect((await getCatalogue(getDb())).some((row) => row.variant === "ST-3 3dr")).toBe(false);

      // Back in the source, the same rows come back to life
      const restored = await upsertReferenceData(owner(), sources());
      expect(restored.catalogue).toEqual({ inserted: 0, updated: 6, deactivated: 0 });
    });

    it("activating v2 retires v1", async () => {
      await upsertReferenceData(owner(), sources());
      const v2 = { ...clone(RATING_SOURCES[0]!), version: 2, effectiveFrom: "2026-12-01" };

      const result = await upsertReferenceData(owner(), sources([...RATING_SOURCES, v2]));

      expect(result.versions).toContainEqual({ product: "car", version: 2, action: "inserted" });
      const car = await owner()
        .select()
        .from(ratingVersions)
        .where(eq(ratingVersions.product, "car"))
        .orderBy(ratingVersions.version);
      expect(car.map((v) => [v.version, v.status, v.effectiveTo])).toEqual([
        [1, "retired", "2026-12-01"],
        [2, "active", null],
      ]);
    });

    it("survives two runs at once", async () => {
      await Promise.all([
        upsertReferenceData(owner(), sources()),
        upsertReferenceData(owner(), sources()),
      ]);
      expect(await count(ratingVersions)).toBe(3);
      expect(await count(vehicleCatalogue)).toBe(expandCatalogue(CATALOGUE_SOURCES).length);
    });

    // Final review: withTx's 10s statement_timeout used to cancel the wait before the 60s lock
    // timeout could apply, so a slow first deploy failed the second
    it("waits longer than 10s for another deploy's lock", { timeout: 30_000 }, async () => {
      const holder = await owner().$client.connect();
      try {
        await holder.query("begin");
        await holder.query("select pg_advisory_xact_lock(hashtext('kerb:reference-data'))");
        const run = upsertReferenceData(owner(), sources());
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        await holder.query("commit");
        await expect(run).resolves.toMatchObject({ catalogue: { deactivated: 0 } });
      } finally {
        await holder.query("rollback").catch(() => undefined);
        holder.release();
      }
    });

    // Final review: a conflict found per version used to leave the catalogue and earlier products
    // committed
    it("refuses an edited version before writing anything else", async () => {
      await upsertReferenceData(owner(), sources());
      const before = await catalogueRows();
      const next = sources();
      next.catalogue[0]!.generations[1]!.variants[0]!.insuranceGroup = 4;
      next.rating[1]!.factors[0]!.multiplier = 9;
      const v2 = { ...clone(RATING_SOURCES[0]!), version: 2, effectiveFrom: "2026-12-01" };
      next.rating.push(v2);

      await expect(upsertReferenceData(owner(), next)).rejects.toThrow(ReferenceDataConflict);
      expect(await catalogueRows()).toEqual(before);
      expect(await count(ratingVersions)).toBe(3);
    });

    it("refuses a new version that doesn't start after the active one, writing nothing", async () => {
      await upsertReferenceData(owner(), sources());
      const v2 = { ...clone(RATING_SOURCES[0]!), version: 2 };

      // Listed with v1, the sources themselves are out of order
      await expect(upsertReferenceData(owner(), sources([...RATING_SOURCES, v2]))).rejects.toThrow(
        "car v2: effectiveFrom 2026-11-01 must be after v1's 2026-11-01",
      );
      // Listed alone, it's checked against the deployed active version
      await expect(upsertReferenceData(owner(), sources([v2]))).rejects.toThrow(
        "car v2: effectiveFrom 2026-11-01 must be after the active v1's 2026-11-01",
      );
      expect(await count(ratingVersions)).toBe(3);
    });

    it("refuses the same version listed twice", async () => {
      await expect(
        upsertReferenceData(owner(), sources([...RATING_SOURCES, RATING_SOURCES[0]!])),
      ).rejects.toThrow("car v1 is listed twice");
      expect(await count(ratingVersions)).toBe(0);
    });
  });

  describe("readers", () => {
    it("memoises rating tables per version", async () => {
      await upsertReferenceData(owner(), sources());
      const active = await getActiveRatingVersion(getDb(), "car");

      const first = await getRatingTables(getDb(), active!.id);
      expect(await getRatingTables(getDb(), active!.id)).toBe(first);
      expect(first.parameters.base_rate_pence).toBe(46_000);
      expect(
        first.factors.find((f) => f.factor === "insurance_group" && f.band === "50"),
      ).toMatchObject({ rangeFrom: 50, rangeTo: null, multiplier: 2.1418 });
      expect(Object.isFrozen(first.factors[0])).toBe(true);
      expect(Object.isFrozen(first.factors)).toBe(true);

      await owner().delete(ratingFactors).where(eq(ratingFactors.ratingVersionId, active!.id));
      expect(await getRatingTables(getDb(), active!.id)).toBe(first);

      clearReferenceCaches();
      expect((await getRatingTables(getDb(), active!.id)).factors).toEqual([]);
    });

    it("returns the active version", async () => {
      expect(await getActiveRatingVersion(getDb(), "car")).toBeNull();
      await upsertReferenceData(owner(), sources());
      expect(await getActiveRatingVersion(getDb(), "car")).toMatchObject({ version: 1 });
    });

    it("loads the catalogue once per instance", async () => {
      await upsertReferenceData(owner(), sources());
      const first = await getCatalogue(getDb());
      expect(first.length).toBe(expandCatalogue(CATALOGUE_SOURCES).length);

      await owner().update(vehicleCatalogue).set({ isActive: false });
      expect(await getCatalogue(getDb())).toBe(first);
    });
  });
});
