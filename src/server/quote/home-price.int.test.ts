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
import type { Journey } from "#/features/quote/journey-store";
import { clearReferenceCaches, upsertReferenceData } from "#/server/data/reference";
import { closeDb } from "#/server/db/client";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";

import { priceHomeJourney } from "./price";

// The home price on the server (5.7, decision 7): checked like the tab, priced from the active home
// version, referred and declined by rating v1's lines, and nothing saved.

// The fixture's dates hold on 11 Nov 2026
const NOW = new Date("2026-11-11T12:00:00Z");
const from = new Headers({ "x-forwarded-for": "203.0.113.21" });

const price = (journey: unknown, voluntaryExcessPence = 0) =>
  priceHomeJourney({ journey, voluntaryExcessPence }, from, NOW, SECRET);

function withRebuild(pounds: number): Journey {
  const journey = completeHomeJourney();
  journey.property!.rebuildCostPounds = pounds;
  return journey;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
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
afterAll(closeDb);

describe("priceHomeJourney", () => {
  it("quotes the fixture home at every level, with home's add-ons", async () => {
    const result = await price(completeHomeJourney());
    if (result.status !== "quoted") throw new Error(`not quoted: ${result.status}`);
    expect(result.levels.map((l) => l.coverLevel)).toEqual(["essential", "comprehensive", "plus"]);
    expect(result.levels.every((l) => l.premiumPence! > 0)).toBe(true);
    expect(result.addons.map((a) => a.addon).sort()).toEqual([
      "home_emergency",
      "legal_expenses",
      "personal_possessions",
    ]);
  });

  it("refers a £1m rebuild, 3 claims and a house built before 1750", async () => {
    expect(await price(withRebuild(1_000_000))).toEqual({ status: "referred", namedDriver: null });

    const claims = completeHomeJourney();
    const claim = claims.homeClaims!.claims[0]!;
    claims.homeClaims!.claims = [claim, { ...claim, id: "h2" }, { ...claim, id: "h3" }];
    expect(await price(claims)).toEqual({ status: "referred", namedDriver: null });

    const old = completeHomeJourney();
    old.property!.yearBuilt = 1700;
    expect(await price(old)).toEqual({ status: "referred", namedDriver: null });
  });

  it("declines a £2.5m rebuild", async () => {
    expect(await price(withRebuild(2_500_000))).toEqual({ status: "declined", namedDriver: null });
  });

  it("declines a Crown dependency", async () => {
    expect(await price({ ...completeHomeJourney(), postcode: "JE2 3AB" })).toEqual({
      status: "declined",
      namedDriver: null,
    });
  });

  it("sends a journey back to its first unfinished step", async () => {
    const { contents: _c, ...journey } = completeHomeJourney();
    expect(await price(journey)).toEqual({ status: "invalid", step: "contents" });
    expect(await price(null)).toEqual({ status: "invalid", step: "about" });
  });

  it("sends an excess it doesn't offer back to cover", async () => {
    expect(await price(completeHomeJourney(), 12_345)).toEqual({
      status: "invalid",
      step: "cover",
    });
  });
});
