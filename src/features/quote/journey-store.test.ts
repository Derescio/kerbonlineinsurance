import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  beginJourney,
  journeyKey,
  markStartRecorded,
  readJourney,
  sessionStore,
  setLastPlate,
  setPayment,
  setStepAnswers,
  setVehicle,
  type JourneyStorage,
  type VehicleChoice,
} from "./journey-store";
import { completeJourney } from "./journey-fixtures";

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

// 5.2 (call 12): the confirmed car, and the last plate typed for screen 10 (call 9)
describe("the car in the journey", () => {
  const golf: VehicleChoice = {
    catalogueVariantId: "0195b2c4-7d1e-7a3f-9b2c-5e6f7a8b9c0d",
    make: "Volkswagen",
    model: "Golf",
    year: 2021,
    variant: "1.0 TSI Life 5dr",
    fuelType: "petrol",
    doors: 5,
    demoPlate: "VW21 GQL",
  };

  it("still reads a 5.1 journey with no car", () => {
    const storage = memoryStorage();
    beginJourney("car", "E8 3RL", now, storage);
    expect(readJourney("car", storage)?.vehicle).toBeUndefined();
  });

  it("keeps the confirmed car, and removes it", () => {
    const storage = memoryStorage();
    beginJourney("car", "E8 3RL", now, storage);
    setVehicle(golf, storage);
    expect(readJourney("car", storage)?.vehicle).toEqual(golf);
    setVehicle(null, storage);
    expect(readJourney("car", storage)?.vehicle).toBeUndefined();
    expect(readJourney("car", storage)?.postcode).toBe("E8 3RL");
  });

  it("keeps the last plate typed", () => {
    const storage = memoryStorage();
    beginJourney("car", "E8 3RL", now, storage);
    setLastPlate("KR24BXL", storage);
    expect(readJourney("car", storage)?.lastPlate).toBe("KR24BXL");
  });

  it("does nothing without a car journey", () => {
    const storage = memoryStorage();
    setVehicle(golf, storage);
    setLastPlate("KR24BXL", storage);
    expect(storage.map.size).toBe(0);
  });

  it("drops a malformed car and keeps the rest of the journey (5.3, call 15)", () => {
    const storage = memoryStorage();
    const journey = beginJourney("car", "E8 3RL", now, storage);
    storage.map.set(
      journeyKey("car"),
      JSON.stringify({ ...journey, vehicle: { ...golf, year: "2021" } }),
    );
    expect(readJourney("car", storage)).toEqual(journey);
  });

  it("treats a malformed base as a corrupt journey", () => {
    const storage = memoryStorage();
    const journey = beginJourney("car", "E8 3RL", now, storage);
    storage.map.set(journeyKey("car"), JSON.stringify({ ...journey, journeyId: 7 }));
    expect(readJourney("car", storage)).toBeNull();
  });

  it("survives storage throwing", () => {
    expect(() => setVehicle(golf, broken)).not.toThrow();
    expect(() => setLastPlate("KR24BXL", broken)).not.toThrow();
  });
});

describe("the driver steps in the journey (5.3)", () => {
  function carJourney(storage: JourneyStorage) {
    beginJourney("car", "E8 3RL", now, storage);
    setVehicle(fixture.vehicle!, storage);
  }
  const fixture = completeJourney();

  it("round-trips all four parts", () => {
    const storage = memoryStorage();
    carJourney(storage);
    const { licenceType, licenceDate, noClaimsYears, ...about } = fixture.mainDriver!;
    setStepAnswers("about", about, storage);
    setStepAnswers(
      "driving",
      {
        licenceType: licenceType!,
        licenceDate: licenceDate!,
        noClaimsYears: noClaimsYears!,
        ...fixture.usage!,
      },
      storage,
    );
    setStepAnswers("claims", { ...fixture.claims!, confirmed: true }, storage);
    setStepAnswers("drivers", fixture.namedDrivers!, storage);
    const read = readJourney("car", storage)!;
    expect(read.mainDriver).toEqual(fixture.mainDriver);
    expect(read.usage).toEqual(fixture.usage);
    expect(read.claims).toEqual(fixture.claims);
    expect(read.namedDrivers).toEqual(fixture.namedDrivers);
  });

  it("keeps the licence answers when About you is saved again", () => {
    const storage = memoryStorage();
    storage.map.set(journeyKey("car"), JSON.stringify(fixture));
    const { licenceType: _t, licenceDate: _d, noClaimsYears: _n, ...about } = fixture.mainDriver!;
    setStepAnswers("about", { ...about, firstName: "Sam" }, storage);
    expect(readJourney("car", storage)!.mainDriver).toEqual({
      ...fixture.mainDriver,
      firstName: "Sam",
    });
  });

  it("still reads a 5.2 journey with only a car", () => {
    const storage = memoryStorage();
    carJourney(storage);
    const read = readJourney("car", storage)!;
    expect(read.vehicle).toEqual(fixture.vehicle);
    expect(read.mainDriver).toBeUndefined();
  });

  it("drops only a part that no longer parses", () => {
    const storage = memoryStorage();
    const bad = completeJourney();
    (bad.claims!.incidents[0] as { type: string }).type = "meteor";
    storage.map.set(journeyKey("car"), JSON.stringify(bad));
    const read = readJourney("car", storage)!;
    expect(read.claims).toBeUndefined();
    expect(read.vehicle).toEqual(fixture.vehicle);
    expect(read.mainDriver).toEqual(fixture.mainDriver);
    expect(read.namedDrivers).toEqual(fixture.namedDrivers);
  });

  it("keeps the driver answers when the car changes", () => {
    const storage = memoryStorage();
    storage.map.set(journeyKey("car"), JSON.stringify(fixture));
    setVehicle({ ...fixture.vehicle!, catalogueVariantId: "fiesta-1", model: "Fiesta" }, storage);
    expect(readJourney("car", storage)!.mainDriver).toEqual(fixture.mainDriver);
  });

  it("does nothing without a car journey", () => {
    const storage = memoryStorage();
    setStepAnswers("drivers", fixture.namedDrivers!, storage);
    expect(storage.map.size).toBe(0);
  });
});

describe("the pay choice in the journey (5.4b, call 10)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps annual or monthly", () => {
    const storage = memoryStorage();
    beginJourney("car", "E8 3RL", now, storage);
    expect(readJourney("car", storage)?.payment).toBeUndefined();
    setPayment("car", "monthly", storage);
    expect(readJourney("car", storage)?.payment).toBe("monthly");
    setPayment("car", "annual", storage);
    expect(readJourney("car", storage)?.payment).toBe("annual");
  });

  it("drops only a pay choice that isn't annual or monthly", () => {
    const storage = memoryStorage();
    const journey = beginJourney("car", "E8 3RL", now, storage);
    storage.setItem(journeyKey("car"), JSON.stringify({ ...journey, payment: "weekly" }));
    const read = readJourney("car", storage);
    expect(read?.journeyId).toBe(journey.journeyId);
    expect(read?.payment).toBeUndefined();
  });

  it("does nothing without a journey", () => {
    const storage = memoryStorage();
    setPayment("car", "monthly", storage);
    expect(readJourney("car", storage)).toBeNull();
  });
});
