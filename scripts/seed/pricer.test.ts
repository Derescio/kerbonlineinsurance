import { describe, expect, it } from "vite-plus/test";

import { expandCatalogue } from "#/server/reference/catalogue/expand";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { CALIBRATION_PEOPLE } from "#/server/reference/rating/calibration";
import { RATING_SOURCES } from "#/server/reference/rating/index";

import { ipt, priceItem } from "./pricer.ts";
import type { CarInputs, PricingInputs } from "./pricer.ts";

const sourceFor = (product: string) => RATING_SOURCES.find((s) => s.product === product)!;
const catalogue = expandCatalogue(CATALOGUE_SOURCES);

// The example people's inputs are loosely typed (Record<string, unknown>)
const asItem = (product: string, inputs: unknown) =>
  ({ product, inputs }) as unknown as PricingInputs;

// The example people name their car but not its fuel; the seed takes it from the catalogue too
// (the hand price for C4, a Tesla, includes the electric factor)
function withCatalogueFuel(inputs: Record<string, unknown>): Record<string, unknown> {
  const vehicle = inputs.vehicle as CarInputs["vehicle"] | undefined;
  if (!vehicle) return inputs;
  const row = catalogue.find(
    (r) =>
      r.make === vehicle.make &&
      r.model === vehicle.model &&
      r.year === vehicle.year &&
      r.variant === vehicle.variant,
  );
  return { ...inputs, vehicle: { ...vehicle, fuelType: row?.fuelType ?? "petrol" } };
}

// The 4.8 example people, priced by the stand-in: within 1% of the spec's hand calculation (the hand
// figures round each step) and inside the market target
describe.each(CALIBRATION_PEOPLE)("calibration person $id", (person) => {
  const item = asItem(person.product, withCatalogueFuel(person.inputs));
  const priced = priceItem(sourceFor(person.product), item);
  const expected = person.expected;

  if (expected.outcome === "quoted") {
    it("is quoted near the hand price", () => {
      expect(priced.outcome).toBe("quoted");
      const coverLevel = (person.inputs as { coverLevel: string }).coverLevel;
      const option = priced.options.find((o) => o.coverLevel === coverLevel)!;
      const chosen = ((person.inputs as { addons?: string[] }).addons ?? []).map(
        (name) => priced.addons.find((a) => a.addon === name)!.annualPricePence,
      );
      const premium = option.annualPremiumPence + chosen.reduce((sum, p) => sum + p, 0);
      const total = premium + ipt(premium, priced.iptRate);
      expect(Math.abs(total - expected.handPence) / expected.handPence).toBeLessThanOrEqual(0.01);
      expect(total).toBeGreaterThanOrEqual(expected.minPence);
      expect(total).toBeLessThanOrEqual(expected.maxPence);
    });
  } else {
    it(`is ${expected.outcome} for ${expected.reason}`, () => {
      expect(priced.outcome).toBe(expected.outcome);
      expect(priced.reasonCode).toBe(expected.reason);
    });
  }

  it("prices all three tiers, monthly never cheaper than annual", () => {
    expect(priced.options.map((o) => o.coverLevel)).toEqual(["essential", "comprehensive", "plus"]);
    for (const option of priced.options) {
      expect(option.annualPremiumPence).toBeGreaterThan(0);
      expect(option.monthlyPremiumPence * 12).toBeGreaterThanOrEqual(option.annualPremiumPence);
    }
  });

  it("records each factor once", () => {
    const names = priced.factors.map((f) => f.factor);
    expect(new Set(names).size).toBe(names.length);
    for (const f of priced.factors) expect(f.multiplier).toBeGreaterThan(0);
  });
});

describe("priceItem", () => {
  const c1 = CALIBRATION_PEOPLE.find((p) => p.id === "C1")!;

  it("refuses an unknown occupation rather than using 1", () => {
    const inputs = structuredClone(c1.inputs) as { driver: { occupation: string } };
    inputs.driver.occupation = "astronaut";
    expect(() => priceItem(sourceFor("car"), asItem("car", inputs))).toThrow(
      /unknown occupation: astronaut/,
    );
  });

  it("adds the young driver excess under 25", () => {
    const c2 = CALIBRATION_PEOPLE.find((p) => p.id === "C2")!;
    const priced = priceItem(sourceFor("car"), asItem("car", c2.inputs));
    const comprehensive = priced.options.find((o) => o.coverLevel === "comprehensive")!;
    expect(comprehensive.compulsoryExcessPence).toBe(25_000 + 25_000);
  });

  it("refers a premium above the maximum", () => {
    // C1's comprehensive is about £422 before IPT: a £300 maximum refers it
    const car = sourceFor("car");
    const source = { ...car, parameters: { ...car.parameters, max_premium_pence: 30_000 } };
    const priced = priceItem(source, asItem("car", c1.inputs));
    expect(priced.outcome).toBe("referred");
    expect(priced.reasonCode).toBe("premium_above_max");
  });

  it("offers business add-ons only to their trade group", () => {
    const b1 = CALIBRATION_PEOPLE.find((p) => p.id === "B1")!; // electrician: trades
    const priced = priceItem(sourceFor("business"), asItem("business", b1.inputs));
    const offered = priced.addons.map((a) => a.addon);
    expect(offered).toContain("tools");
    expect(offered).not.toContain("professional_indemnity");
  });
});
