import { describe, expect, it } from "vite-plus/test";

import { UK_POSTCODE_AREAS } from "#/server/reference/postcode-areas";

import { AREA_WEIGHTS } from "./names.ts";
import { Rng, SEED_FROM, SEED_TO, uuidv7At } from "./random.ts";

const take = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.next());

describe("Rng", () => {
  it("repeats for the same seed and differs for another", () => {
    expect(take(new Rng(1), 5)).toEqual(take(new Rng(1), 5));
    expect(take(new Rng(1), 5)).not.toEqual(take(new Rng(2), 5));
  });

  it("stays in [0, 1)", () => {
    for (const v of take(new Rng(7), 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("forks stable, independent streams by label", () => {
    expect(take(new Rng(1).fork("a"), 5)).toEqual(take(new Rng(1).fork("a"), 5));
    expect(take(new Rng(1).fork("a"), 5)).not.toEqual(take(new Rng(1).fork("b"), 5));
    // Forking doesn't depend on how far the parent has been read
    const parent = new Rng(1);
    parent.next();
    expect(take(parent.fork("a"), 5)).toEqual(take(new Rng(1).fork("a"), 5));
  });

  it("int is inclusive at both ends", () => {
    const seen = new Set(Array.from({ length: 500 }, () => new Rng(3).int(1, 1)));
    expect(seen).toEqual(new Set([1]));
    const rng = new Rng(3);
    const values = new Set(Array.from({ length: 500 }, () => rng.int(1, 3)));
    expect(values).toEqual(new Set([1, 2, 3]));
  });

  it("never picks a zero weight", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 1000; i++) {
      expect(
        rng.weighted([
          ["x", 0],
          ["y", 1],
        ]),
      ).toBe("y");
    }
  });

  it("keeps dates inside the window", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 1000; i++) {
      const d = rng.dateBetween(SEED_FROM, SEED_TO).getTime();
      expect(d).toBeGreaterThanOrEqual(SEED_FROM.getTime());
      expect(d).toBeLessThanOrEqual(SEED_TO.getTime());
    }
  });
});

describe("uuidv7At", () => {
  it("is a v7 uuid carrying the timestamp", () => {
    const at = new Date("2026-03-01T00:00:00Z");
    const id = uuidv7At(at, new Rng(1));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.replace(/-/g, "").slice(0, 12)).toBe(at.getTime().toString(16).padStart(12, "0"));
  });

  it("sorts by time", () => {
    const rng = new Rng(1);
    const a = uuidv7At(new Date("2026-01-01T00:00:00Z"), rng);
    const b = uuidv7At(new Date("2026-01-02T00:00:00Z"), rng);
    expect(a < b).toBe(true);
  });
});

describe("AREA_WEIGHTS", () => {
  it("names only real areas", () => {
    for (const area of Object.keys(AREA_WEIGHTS)) {
      expect(UK_POSTCODE_AREAS).toContain(area);
    }
  });
});
