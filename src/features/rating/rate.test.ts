import { describe, expect, it } from "vite-plus/test";

import { carV1 } from "#/server/reference/rating/car-v1";

import { priceOptions, rateBusiness, rateCar, rateHome } from "./rate";
import { Tables } from "./tables";
import {
  businessInputs,
  carInputs,
  flatBusiness,
  flatCar,
  flatHome,
  homeInputs,
} from "./test-tables";

const comprehensive = (options: ReturnType<typeof priceOptions>) =>
  options.find((o) => o.coverLevel === "comprehensive")!;

describe("rateCar", () => {
  it("multiplies the factors exactly and rounds once", () => {
    const t = new Tables(
      flatCar({
        parameters: { base_rate_pence: 1_001, min_premium_pence: 100 },
        multipliers: { driver_age: 1.15, postcode_band: 1.15, insurance_group: 1.15 },
      }),
    );
    // 1001 × 1.15 × 1.15 × 1.15 = 1001 × 1.520875 = 1522.395875 → 1522
    // (rounding after each step would give 1151 → 1324 → 1523)
    expect(comprehensive(priceOptions(t, rateCar(t, carInputs()))).annualPremiumPence).toBe(1_522);
  });

  it("raises a premium below the minimum to it, on every tier", () => {
    const t = new Tables(
      flatCar({
        parameters: { base_rate_pence: 1_000, min_premium_pence: 22_500 },
        tiers: { essential: 0.8, comprehensive: 1, plus: 1.2 },
      }),
    );
    // 1000 × 0.8 / 1 / 1.2 are all under 22500, so all three are 22500
    const options = priceOptions(t, rateCar(t, carInputs()));
    expect(options.map((o) => o.annualPremiumPence)).toEqual([22_500, 22_500, 22_500]);
  });

  it("stores each tier's monthly figure before IPT, 10% more", () => {
    const t = new Tables(flatCar({ parameters: { base_rate_pence: 63_000 } }));
    // 63000 × 1 = 63000; 63000 × 1.10 / 12 = 5775
    const option = comprehensive(priceOptions(t, rateCar(t, carInputs())));
    expect(option.annualPremiumPence).toBe(63_000);
    expect(option.monthlyPremiumPence).toBe(5_775);
  });

  it("rates the youngest named driver, once", () => {
    const t = new Tables(carV1);
    const rated = rateCar(
      t,
      carInputs({
        namedDrivers: [
          { age: 40, licenceYears: 20 },
          { age: 19, licenceYears: 1 },
        ],
      }),
    );
    const rows = rated.factors.filter((f) => f.factor === "named_driver_age");
    // The band v1 gives a 19-year-old, read from the table itself
    const band19 = carV1.factors.find(
      (f) =>
        f.factor === "named_driver_age" &&
        f.rangeFrom! <= 19 &&
        (f.rangeTo === null || 19 <= f.rangeTo),
    )!;
    expect(rows).toEqual([
      { factor: "named_driver_age", inputValue: band19.band, multiplier: band19.multiplier },
    ]);
  });

  it("has no named-driver factor without named drivers", () => {
    const t = new Tables(carV1);
    expect(rateCar(t, carInputs()).factors.some((f) => f.factor === "named_driver_age")).toBe(
      false,
    );
  });

  it("adds the young-driver excess when any driver is under 25", () => {
    const t = new Tables(carV1);
    const tier = carV1.tiers.find((x) => x.coverLevel === "comprehensive")!;
    const young = rateCar(t, carInputs({ namedDrivers: [{ age: 22, licenceYears: 4 }] }));
    const notYoung = rateCar(t, carInputs({ namedDrivers: [{ age: 25, licenceYears: 7 }] }));
    // v1: young_driver_excess_pence = 25000, added to the tier's compulsory excess
    expect(comprehensive(priceOptions(t, young)).compulsoryExcessPence).toBe(
      tier.compulsoryExcessPence + 25_000,
    );
    expect(comprehensive(priceOptions(t, notYoung)).compulsoryExcessPence).toBe(
      tier.compulsoryExcessPence,
    );
  });

  it("refuses an unknown occupation rather than using 1", () => {
    const t = new Tables(carV1);
    expect(() =>
      rateCar(t, carInputs({ driver: { ...carInputs().driver, occupation: "astronaut" } })),
    ).toThrow("car: unknown occupation: astronaut");
  });

  it("refuses a missing parameter", () => {
    const t = new Tables(flatCar({ without: ["base_rate_pence"] }));
    expect(() => rateCar(t, carInputs())).toThrow("car: missing parameter base_rate_pence");
  });

  it("refuses a value with no band", () => {
    const t = new Tables(carV1);
    expect(() =>
      rateCar(t, carInputs({ vehicle: { ...carInputs().vehicle, insuranceGroup: 0 } })),
    ).toThrow("car: insurance_group has no band for 0");
  });
});

describe("each factor is recorded once", () => {
  const once = (names: string[]) => expect(new Set(names).size).toBe(names.length);

  it("car, with a named driver", () => {
    const t = new Tables(carV1);
    once(
      rateCar(t, carInputs({ namedDrivers: [{ age: 30, licenceYears: 10 }] })).factors.map(
        (f) => f.factor,
      ),
    );
  });

  it("home", () => {
    const t = new Tables(flatHome());
    once(rateHome(t, homeInputs()).factors.map((f) => f.factor));
  });

  it("business", () => {
    const t = new Tables(flatBusiness());
    once(rateBusiness(t, businessInputs()).factors.map((f) => f.factor));
  });
});
