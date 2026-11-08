import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "#/server/db/client";
import {
  ratingAddons,
  ratingFactors,
  ratingLookups,
  ratingParameters,
  ratingTiers,
  ratingVersions,
  vehicleCatalogue,
} from "#/server/db/schema";
import type { Product } from "#/server/db/schema/values";
import { CatalogueError, expandCatalogue } from "#/server/reference/catalogue/expand";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import type { CatalogueRow, MakeSource } from "#/server/reference/catalogue/types";
import { contentHash } from "#/server/reference/rating/hash";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { ratingSourceSchema, type RatingSource } from "#/server/reference/rating/types";
import { validateRatingSource } from "#/server/reference/rating/validate";

// Reference data (4.8, plan/phases/04-data-auth/08-reference-data.md). The deploy writes it as the
// owner with upsertReferenceData (kerb_app can't, call 18); the app reads it through the memoised
// readers below. Not protected reads: the catalogue and rates are the same for everyone, so this
// module is outside the permission suite, like account.ts.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ReferenceDataConflict extends Error {
  override name = "ReferenceDataConflict";
}

export class ReferenceDataInvalid extends Error {
  override name = "ReferenceDataInvalid";
}

export interface UpsertResult {
  catalogue: { inserted: number; updated: number; deactivated: number };
  versions: { product: Product; version: number; action: "inserted" | "unchanged" }[];
}

interface Sources {
  rating: readonly RatingSource[];
  catalogue: readonly MakeSource[];
}

// One deploy at a time per database: a quick redeploy waits, then finds nothing to do
const lock = (tx: Tx) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext('kerb:reference-data'))`);

const BATCH = 500;

function validate(sources: Sources): CatalogueRow[] {
  const problems: string[] = [];
  for (const source of sources.rating) {
    const name = `${source.product} v${source.version}`;
    const parsed = ratingSourceSchema.safeParse(source);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((i) => `${name}: ${i.path.join(".")} ${i.message}`));
      continue;
    }
    problems.push(...validateRatingSource(parsed.data).map((problem) => `${name}: ${problem}`));
  }
  let rows: CatalogueRow[] = [];
  try {
    rows = expandCatalogue(sources.catalogue);
  } catch (error) {
    if (!(error instanceof CatalogueError)) throw error;
    problems.push(`catalogue: ${error.message}`);
  }
  if (problems.length > 0) {
    throw new ReferenceDataInvalid(`Reference data is invalid:\n- ${problems.join("\n- ")}`);
  }
  return rows;
}

async function upsertCatalogue(db: Db, rows: CatalogueRow[]): Promise<UpsertResult["catalogue"]> {
  return db.transaction(async (tx) => {
    await lock(tx);
    let inserted = 0;
    let updated = 0;
    const t = vehicleCatalogue;
    for (let i = 0; i < rows.length; i += BATCH) {
      const written = await tx
        .insert(t)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: [t.make, t.model, t.year, t.variant],
          set: {
            bodyStyle: sql`excluded.body_style`,
            fuelType: sql`excluded.fuel_type`,
            transmission: sql`excluded.transmission`,
            doors: sql`excluded.doors`,
            engineCc: sql`excluded.engine_cc`,
            powerBhp: sql`excluded.power_bhp`,
            insuranceGroup: sql`excluded.insurance_group`,
            valuePence: sql`excluded.value_pence`,
            isActive: true,
          },
          // Only rows that differ, so an unchanged catalogue keeps its updated_at
          setWhere: sql`(${t.bodyStyle}, ${t.fuelType}, ${t.transmission}, ${t.doors}, ${t.engineCc},
            ${t.powerBhp}, ${t.insuranceGroup}, ${t.valuePence}, ${t.isActive})
            is distinct from (excluded.body_style, excluded.fuel_type, excluded.transmission,
            excluded.doors, excluded.engine_cc, excluded.power_bhp, excluded.insurance_group,
            excluded.value_pence, true)`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      for (const row of written) {
        if (row.inserted) inserted++;
        else updated++;
      }
    }

    // A variant dropped from the source is kept, inactive, so vehicles that point at it still join
    const keep = new Set(
      rows.map((r) => `${r.make}\u0000${r.model}\u0000${r.year}\u0000${r.variant}`),
    );
    const active = await tx
      .select({ id: t.id, make: t.make, model: t.model, year: t.year, variant: t.variant })
      .from(t)
      .where(eq(t.isActive, true));
    const gone = active
      .filter((r) => !keep.has(`${r.make}\u0000${r.model}\u0000${r.year}\u0000${r.variant}`))
      .map((r) => r.id);
    for (let i = 0; i < gone.length; i += BATCH) {
      await tx
        .update(t)
        .set({ isActive: false })
        .where(inArray(t.id, gone.slice(i, i + BATCH)));
    }
    return { inserted, updated, deactivated: gone.length };
  });
}

const four = (value: number) => value.toFixed(4);

async function upsertVersion(
  db: Db,
  source: RatingSource,
): Promise<UpsertResult["versions"][number]> {
  const { product, version } = source;
  const hash = contentHash(source);
  return db.transaction(async (tx) => {
    await lock(tx);
    const [existing] = await tx
      .select({ contentHash: ratingVersions.contentHash })
      .from(ratingVersions)
      .where(and(eq(ratingVersions.product, product), eq(ratingVersions.version, version)));
    if (existing) {
      if (existing.contentHash === hash) return { product, version, action: "unchanged" };
      throw new ReferenceDataConflict(
        `${product} v${version} is already in the database with different tables; add v${version + 1} instead`,
      );
    }

    // A new version takes over from the active one on its effective date
    await tx
      .update(ratingVersions)
      .set({ status: "retired", effectiveTo: source.effectiveFrom })
      .where(and(eq(ratingVersions.product, product), eq(ratingVersions.status, "active")));
    const [row] = await tx
      .insert(ratingVersions)
      .values({
        product,
        version,
        status: "active",
        effectiveFrom: source.effectiveFrom,
        notes: source.notes,
        contentHash: hash,
      })
      .returning({ id: ratingVersions.id });
    const ratingVersionId = row!.id;

    await tx.insert(ratingParameters).values(
      Object.entries(source.parameters).map(([name, value]) => ({
        ratingVersionId,
        name,
        value: four(value),
      })),
    );
    await tx.insert(ratingTiers).values(
      source.tiers.map((tier) => ({
        ratingVersionId,
        ...tier,
        multiplier: four(tier.multiplier),
      })),
    );
    if (source.addons.length > 0) {
      await tx.insert(ratingAddons).values(source.addons.map((a) => ({ ratingVersionId, ...a })));
    }
    for (let i = 0; i < source.factors.length; i += BATCH) {
      await tx
        .insert(ratingFactors)
        .values(
          source.factors
            .slice(i, i + BATCH)
            .map((f) => ({ ratingVersionId, ...f, multiplier: four(f.multiplier) })),
        );
    }
    for (let i = 0; i < source.lookups.length; i += BATCH) {
      await tx
        .insert(ratingLookups)
        .values(source.lookups.slice(i, i + BATCH).map((l) => ({ ratingVersionId, ...l })));
    }
    return { product, version, action: "inserted" };
  });
}

/**
 * Writes the catalogue and every rating version, as the owner. Every source is validated before
 * the first write; a version already in the database is left alone if its hash matches and refused
 * if it doesn't (call 9). Safe to run any number of times, and from two deploys at once.
 */
export async function upsertReferenceData(
  db: Db,
  sources: Sources = { rating: RATING_SOURCES, catalogue: CATALOGUE_SOURCES },
): Promise<UpsertResult> {
  const rows = validate(sources);
  const catalogue = await upsertCatalogue(db, rows);
  const versions: UpsertResult["versions"] = [];
  for (const source of sources.rating) versions.push(await upsertVersion(db, source));
  return { catalogue, versions };
}

// --- Readers -------------------------------------------------------------------------------------
// Memoised in module scope (call 19). A rating version never changes, so its cache can't go stale;
// the catalogue only changes in a deploy, and a deploy starts new function instances. Everything
// returned is frozen: a caller that changed it would change every later quote in this instance.

export type CatalogueRecord = Readonly<CatalogueRow & { id: string }>;
export type RatingTables = Readonly<
  Omit<RatingSource, "notes"> & { id: string; parameters: Readonly<Record<string, number>> }
>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

let catalogueCache: Promise<readonly CatalogueRecord[]> | undefined;
const tablesCache = new Map<string, Promise<RatingTables>>();

/** Clears the memos. Tests only: in the app, a new deploy is a new instance. */
export function clearReferenceCaches(): void {
  catalogueCache = undefined;
  tablesCache.clear();
}

/** Every active catalogue row, ordered for the picker (make → model → year → variant). */
export function getCatalogue(db: Db): Promise<readonly CatalogueRecord[]> {
  if (!catalogueCache) {
    const t = vehicleCatalogue;
    catalogueCache = db
      .select({
        id: t.id,
        make: t.make,
        model: t.model,
        year: t.year,
        variant: t.variant,
        bodyStyle: t.bodyStyle,
        fuelType: t.fuelType,
        transmission: t.transmission,
        doors: t.doors,
        engineCc: t.engineCc,
        powerBhp: t.powerBhp,
        insuranceGroup: t.insuranceGroup,
        valuePence: t.valuePence,
      })
      .from(t)
      .where(eq(t.isActive, true))
      .orderBy(asc(t.make), asc(t.model), asc(t.year), asc(t.variant))
      .then((rows) => deepFreeze(rows as CatalogueRecord[]));
    catalogueCache.catch(() => {
      catalogueCache = undefined;
    });
  }
  return catalogueCache;
}

async function loadRatingTables(db: Db, id: string): Promise<RatingTables> {
  const [version] = await db.select().from(ratingVersions).where(eq(ratingVersions.id, id));
  if (!version) throw new Error(`Rating version ${id} not found`);
  const [parameters, tiers, addons, factors, lookups] = await Promise.all([
    db.select().from(ratingParameters).where(eq(ratingParameters.ratingVersionId, id)),
    db.select().from(ratingTiers).where(eq(ratingTiers.ratingVersionId, id)),
    db.select().from(ratingAddons).where(eq(ratingAddons.ratingVersionId, id)),
    db.select().from(ratingFactors).where(eq(ratingFactors.ratingVersionId, id)),
    db.select().from(ratingLookups).where(eq(ratingLookups.ratingVersionId, id)),
  ]);
  return deepFreeze({
    id: version.id,
    product: version.product as Product,
    version: version.version,
    effectiveFrom: version.effectiveFrom,
    parameters: Object.fromEntries(parameters.map((p) => [p.name, Number(p.value)])),
    tiers: tiers.map((t) => ({
      coverLevel: t.coverLevel as RatingSource["tiers"][number]["coverLevel"],
      multiplier: Number(t.multiplier),
      compulsoryExcessPence: t.compulsoryExcessPence,
    })),
    addons: addons.map((a) => ({
      addon: a.addon,
      annualPricePence: a.annualPricePence,
      factors: a.factors,
      availableToGroups: a.availableToGroups,
    })),
    factors: factors.map((f) => ({
      factor: f.factor,
      band: f.band,
      rangeFrom: f.rangeFrom,
      rangeTo: f.rangeTo,
      multiplier: Number(f.multiplier),
    })),
    lookups: lookups.map((l) => ({
      lookup: l.lookup as RatingSource["lookups"][number]["lookup"],
      factor: l.factor,
      key: l.key,
      label: l.label,
      group: l.group,
      band: l.band,
    })),
  });
}

/** One rating version's tables, loaded once per instance (5.4 prices from these). */
export function getRatingTables(db: Db, ratingVersionId: string): Promise<RatingTables> {
  let tables = tablesCache.get(ratingVersionId);
  if (!tables) {
    tables = loadRatingTables(db, ratingVersionId);
    tablesCache.set(ratingVersionId, tables);
    tables.catch(() => tablesCache.delete(ratingVersionId));
  }
  return tables;
}

/** The product's active version, or null. Not cached, so activating a v2 takes effect at once. */
export async function getActiveRatingVersion(
  db: Db,
  product: Product,
): Promise<{ id: string; version: number } | null> {
  const [row] = await db
    .select({ id: ratingVersions.id, version: ratingVersions.version })
    .from(ratingVersions)
    .where(and(eq(ratingVersions.product, product), eq(ratingVersions.status, "active")));
  return row ?? null;
}
