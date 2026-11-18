import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { clearReferenceCaches } from "#/server/data/reference";
import { closeDb } from "#/server/db/client";
import { vehicleCatalogue } from "#/server/db/schema";
import { getOwnerDb, truncateAll } from "#/test/db";

import { CATALOGUE_CACHE_CONTROL, catalogueResponse } from "./catalogue";

// GET /api/catalogue (5.2, call 13): the picker's rows, cached long on the CDN, and an error never
// cached.

const row = (model: string, year: number, variant: string, isActive = true) => ({
  make: "Volkswagen",
  model,
  year,
  variant,
  bodyStyle: "hatchback",
  fuelType: "petrol",
  transmission: "manual",
  doors: 5,
  engineCc: 999,
  powerBhp: 110,
  insuranceGroup: 14,
  valuePence: 2_000_000,
  isActive,
});

describe("catalogueResponse", () => {
  beforeEach(async () => {
    await truncateAll();
    clearReferenceCaches();
    await getOwnerDb()
      .insert(vehicleCatalogue)
      .values([
        row("Golf", 2021, "1.0 TSI Life 5dr"),
        row("Polo", 2020, "1.0 Life 5dr"),
        row("Golf", 2012, "1.4 S 5dr", false),
      ]);
  });
  afterAll(closeDb);

  it("sends the active cars with a long public cache", async () => {
    const response = await catalogueResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CATALOGUE_CACHE_CONTROL);
    expect(CATALOGUE_CACHE_CONTROL).toBe(
      "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400",
    );
    const { cars } = (await response.json()) as { cars: { model: string; year: number }[] };
    expect(cars.map((c) => `${c.model} ${c.year}`).sort()).toEqual(["Golf 2021", "Polo 2020"]);
  });

  it("sends only what the picker needs: no value or insurance group", async () => {
    const { cars } = (await (await catalogueResponse()).json()) as {
      cars: Record<string, unknown>[];
    };
    expect(Object.keys(cars[0] ?? {}).sort()).toEqual([
      "doors",
      "fuelType",
      "id",
      "make",
      "model",
      "transmission",
      "variant",
      "year",
    ]);
  });

  it("never lets the CDN keep a failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await catalogueResponse(() => Promise.reject(new Error("database down")));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    error.mockRestore();
  });
});
