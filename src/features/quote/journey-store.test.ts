import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  beginJourney,
  journeyKey,
  markStartRecorded,
  readJourney,
  sessionStore,
  type JourneyStorage,
} from "./journey-store";

function memoryStorage(): JourneyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

const broken: JourneyStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const now = new Date("2026-11-09T10:00:00.000Z");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("journey store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keys each product apart", () => {
    expect(journeyKey("car")).toBe("kerb.quote.v1.car");
    expect(journeyKey("home")).toBe("kerb.quote.v1.home");
  });

  it("round-trips a new journey", () => {
    const storage = memoryStorage();
    const journey = beginJourney("car", "E8 3RL", now, storage);
    expect(journey).toEqual({
      version: 1,
      journeyId: expect.stringMatching(uuid),
      postcode: "E8 3RL",
      startedAt: "2026-11-09T10:00:00.000Z",
      startRecorded: false,
    });
    expect(readJourney("car", storage)).toEqual(journey);
    expect(readJourney("home", storage)).toBeNull();
  });

  it("keeps the journey when the postcode changes", () => {
    const storage = memoryStorage();
    const first = beginJourney("car", "E8 3RL", now, storage);
    const later = beginJourney("car", "N1 9GU", new Date("2026-11-09T11:00:00Z"), storage);
    expect(later).toEqual({ ...first, postcode: "N1 9GU" });
    expect(readJourney("car", storage)).toEqual(later);
  });

  it("ignores a corrupt or old-version value", () => {
    const storage = memoryStorage();
    const key = journeyKey("home");
    storage.setItem(key, "{");
    expect(readJourney("home", storage)).toBeNull();
    const good = beginJourney("home", "E8 3RL", now, memoryStorage());
    storage.setItem(key, JSON.stringify({ ...good, version: 0 }));
    expect(readJourney("home", storage)).toBeNull();
    const { postcode: _, ...missing } = good;
    storage.setItem(key, JSON.stringify(missing));
    expect(readJourney("home", storage)).toBeNull();
    // A corrupt value is replaced by a fresh journey, not kept
    expect(beginJourney("home", "E8 3RL", now, storage).journeyId).toMatch(uuid);
  });

  it("marks the start as recorded", () => {
    const storage = memoryStorage();
    beginJourney("home", "E8 3RL", now, storage);
    markStartRecorded("home", storage);
    expect(readJourney("home", storage)?.startRecorded).toBe(true);
    // Nothing to mark: no journey is made up
    markStartRecorded("car", storage);
    expect(readJourney("car", storage)).toBeNull();
  });

  it("survives storage throwing on read and write", () => {
    const journey = beginJourney("car", "E8 3RL", now, broken);
    expect(journey.postcode).toBe("E8 3RL");
    expect(readJourney("car", broken)).toBeNull();
    expect(() => markStartRecorded("car", broken)).not.toThrow();
  });

  it("works with no storage at all", () => {
    expect(beginJourney("car", "E8 3RL", now, null).journeyId).toMatch(uuid);
    expect(readJourney("car", null)).toBeNull();
  });

  it("sessionStore is null when there's no window or the getter throws", () => {
    expect(sessionStore()).toBeNull();
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("SecurityError");
      },
    });
    expect(sessionStore()).toBeNull();
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    expect(sessionStore()).toBe(storage);
  });
});
