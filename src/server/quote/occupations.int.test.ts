import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { clearReferenceCaches, upsertReferenceData } from "#/server/data/reference";
import { closeDb } from "#/server/db/client";
import { ratingVersions } from "#/server/db/schema";
import { carV1 } from "#/server/reference/rating/car-v1";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { getOwnerDb, truncateAll } from "#/test/db";

import { CATALOGUE_CACHE_CONTROL } from "./catalogue";
import { occupationsResponse } from "./occupations";

// GET /api/occupations (5.3, call 11): the active car version's occupations as key and label only,
// cached like the catalogue, and an error never cached.

type Body = { occupations: Record<string, unknown>[] };

describe("occupationsResponse", () => {
  beforeEach(async () => {
    await truncateAll();
    clearReferenceCaches();
    await upsertReferenceData(getOwnerDb(), { rating: RATING_SOURCES, catalogue: [] });
  });
  afterAll(closeDb);

  it("sends car v1's occupations, sorted by label, with a long public cache", async () => {
    const response = await occupationsResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CATALOGUE_CACHE_CONTROL);

    const { occupations } = (await response.json()) as Body;
    const expected = carV1.lookups.filter((l) => l.lookup === "occupation").map((l) => l.key);
    expect(new Set(occupations.map((o) => o.key))).toEqual(new Set(expected));
    expect(occupations).toHaveLength(expected.length);

    const labels = occupations.map((o) => o.label as string);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en-GB")));
  });

  it("sends only the key and label: no band or group", async () => {
    const { occupations } = (await (await occupationsResponse()).json()) as Body;
    for (const occupation of occupations) {
      expect(Object.keys(occupation).sort()).toEqual(["key", "label"]);
    }
  });

  it("sends a 503 that isn't cached when the load fails", async () => {
    const response = await occupationsResponse(() => Promise.reject(new Error("down")));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sends a 503 when no car version is active", async () => {
    await getOwnerDb()
      .update(ratingVersions)
      .set({ status: "retired" })
      .where(eq(ratingVersions.product, "car"));
    const response = await occupationsResponse();
    expect(response.status).toBe(503);
  });
});
