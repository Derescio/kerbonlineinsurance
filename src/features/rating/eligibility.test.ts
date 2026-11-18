import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import { businessV1 } from "#/server/reference/rating/business-v1";
import { carV1 } from "#/server/reference/rating/car-v1";
import { homeV1 } from "#/server/reference/rating/home-v1";

import {
  businessEligibility,
  carEligibility,
  coverAreaEligibility,
  homeEligibility,
} from "./eligibility";
import { Tables } from "./tables";
import { businessInputs, carInputs, homeInputs } from "./test-tables";
import type { BusinessInputs, CarDriver, CarInputs, HomeInputs } from "./types";

// Thresholds are car v1's, home v1's and business v1's parameters (4.8, "Rating tables v1").
// Each rule is checked one below, on and one above its number.

const car = new Tables(carV1);
const home = new Tables(homeV1);
const business = new Tables(businessV1);

const withCar = (vehicle: Partial<CarInputs["vehicle"]>, rest: Partial<CarInputs> = {}) =>
  carInputs({ ...rest, vehicle: { ...carInputs().vehicle, ...vehicle } });
const withMain = (driver: Partial<CarInputs["driver"]>, rest: Partial<CarInputs> = {}) =>
  carInputs({ ...rest, driver: { ...carInputs().driver, ...driver } });

describe("carEligibility", () => {
  it("quotes an ordinary risk", () => {
    expect(carEligibility(car, carInputs())).toBeNull();
  });

  it("declines a car worth £150,000 or more", () => {
    // decline_value_pence_min = 15,000,000; 14,999,999 is only referred (refer at 7,500,000)
    expect(carEligibility(car, withCar({ valuePence: 15_000_000 }))).toEqual({
      outcome: "declined",
      reason: "vehicle_value_too_high",
      driver: null,
    });
    expect(carEligibility(car, withCar({ valuePence: 14_999_999 }))?.reason).toBe(
      "high_vehicle_value",
    );
  });

  it("refers a car worth £75,000 or more", () => {
    // refer_value_pence_min = 7,500,000
    expect(carEligibility(car, withCar({ valuePence: 7_499_999 }))).toBeNull();
    expect(carEligibility(car, withCar({ valuePence: 7_500_000 }))).toEqual({
      outcome: "referred",
      reason: "high_vehicle_value",
      driver: null,
    });
  });

  it("declines a main driver under 21 on group 30 or above", () => {
    // decline_young_age_max = 20, decline_young_group_min = 30
    const young = withMain({ age: 20, licenceYears: 2 });
    expect(
      carEligibility(car, { ...young, vehicle: { ...young.vehicle, insuranceGroup: 29 } }),
    ).toBeNull();
    expect(
      carEligibility(car, { ...young, vehicle: { ...young.vehicle, insuranceGroup: 30 } }),
    ).toEqual({ outcome: "declined", reason: "young_driver_high_group", driver: "main" });
    const at21 = withMain({ age: 21, licenceYears: 3 });
    expect(
      carEligibility(car, { ...at21, vehicle: { ...at21.vehicle, insuranceGroup: 30 } }),
    ).toBeNull();
  });

  it("declines a main driver under 25 on group 40 or above", () => {
    // decline_under25_group_min = 40
    const d = withMain({ age: 24, licenceYears: 5 });
    expect(carEligibility(car, { ...d, vehicle: { ...d.vehicle, insuranceGroup: 39 } })).toBeNull();
    expect(carEligibility(car, { ...d, vehicle: { ...d.vehicle, insuranceGroup: 40 } })).toEqual({
      outcome: "declined",
      reason: "young_driver_high_group",
      driver: "main",
    });
    const at25 = withMain({ age: 25, licenceYears: 5 });
    expect(
      carEligibility(car, { ...at25, vehicle: { ...at25.vehicle, insuranceGroup: 40 } }),
    ).toBeNull();
  });

  it("refers group 45 or above", () => {
    // refer_insurance_group_min = 45
    expect(carEligibility(car, withCar({ insuranceGroup: 44 }))).toBeNull();
    expect(carEligibility(car, withCar({ insuranceGroup: 45 }))).toEqual({
      outcome: "referred",
      reason: "high_insurance_group",
      driver: null,
    });
  });

  it("refers 3 or more past claims across all drivers", () => {
    // refer_past_claims_min = 3
    expect(carEligibility(car, carInputs({ pastClaims: 2 }))).toBeNull();
    expect(carEligibility(car, carInputs({ pastClaims: 3 }))).toEqual({
      outcome: "referred",
      reason: "past_claims",
      driver: null,
    });
  });

  it("refers a new licence on group 25 or above", () => {
    // refer_new_licence_years_max = 0, refer_new_licence_group_min = 25
    const fresh = withMain({ age: 30, licenceYears: 0 });
    expect(
      carEligibility(car, { ...fresh, vehicle: { ...fresh.vehicle, insuranceGroup: 24 } }),
    ).toBeNull();
    expect(
      carEligibility(car, { ...fresh, vehicle: { ...fresh.vehicle, insuranceGroup: 25 } }),
    ).toEqual({ outcome: "referred", reason: "new_licence_high_group", driver: "main" });
    const oneYear = withMain({ age: 30, licenceYears: 1 });
    expect(
      carEligibility(car, { ...oneYear, vehicle: { ...oneYear.vehicle, insuranceGroup: 25 } }),
    ).toBeNull();
  });

  it("refers a driver aged 80 or over", () => {
    // refer_age_min = 80
    expect(carEligibility(car, withMain({ age: 79, licenceYears: 60 }))).toBeNull();
    expect(carEligibility(car, withMain({ age: 80, licenceYears: 60 }))).toEqual({
      outcome: "referred",
      reason: "driver_age",
      driver: "main",
    });
  });

  describe("named drivers", () => {
    const tesla = (namedDrivers: CarDriver[], driver: Partial<CarInputs["driver"]> = {}) =>
      withMain(driver, {
        namedDrivers,
        vehicle: { ...carInputs().vehicle, insuranceGroup: 32 },
      });

    it("declines a 19-year-old named driver on group 32, naming them", () => {
      expect(carEligibility(car, tesla([{ age: 19, licenceYears: 1 }]))).toEqual({
        outcome: "declined",
        reason: "young_driver_high_group",
        driver: 1,
      });
    });

    it("names the second named driver when they're the one", () => {
      expect(
        carEligibility(
          car,
          tesla([
            { age: 30, licenceYears: 10 },
            { age: 19, licenceYears: 1 },
          ]),
        ),
      ).toMatchObject({ driver: 2 });
    });

    it("names the first named driver when two trip the same rule", () => {
      expect(
        carEligibility(
          car,
          tesla([
            { age: 19, licenceYears: 1 },
            { age: 18, licenceYears: 1 },
          ]),
        ),
      ).toMatchObject({ driver: 1 });
    });

    it("puts a named driver's decline before the main driver's referral", () => {
      expect(carEligibility(car, tesla([{ age: 19, licenceYears: 1 }], { age: 80 }))).toEqual({
        outcome: "declined",
        reason: "young_driver_high_group",
        driver: 1,
      });
    });

    it("refers a named driver aged 80 or a new licence on a high group", () => {
      expect(
        carEligibility(car, carInputs({ namedDrivers: [{ age: 80, licenceYears: 60 }] })),
      ).toEqual({ outcome: "referred", reason: "driver_age", driver: 1 });
      expect(
        carEligibility(
          car,
          withCar({ insuranceGroup: 25 }, { namedDrivers: [{ age: 40, licenceYears: 0 }] }),
        ),
      ).toEqual({ outcome: "referred", reason: "new_licence_high_group", driver: 1 });
    });
  });
});

describe("homeEligibility", () => {
  it("quotes an ordinary home", () => {
    expect(homeEligibility(home, homeInputs())).toBeNull();
  });

  it("declines a rebuild cost of £2.5m or more, and refers £1m or more", () => {
    // decline_rebuild_pence_min = 250,000,000; refer_rebuild_pence_min = 100,000,000
    expect(homeEligibility(home, homeInputs({ rebuildCostPence: 99_999_999 }))).toBeNull();
    expect(homeEligibility(home, homeInputs({ rebuildCostPence: 100_000_000 }))?.reason).toBe(
      "high_rebuild_cost",
    );
    expect(homeEligibility(home, homeInputs({ rebuildCostPence: 249_999_999 }))?.reason).toBe(
      "high_rebuild_cost",
    );
    expect(homeEligibility(home, homeInputs({ rebuildCostPence: 250_000_000 }))).toEqual({
      outcome: "declined",
      reason: "rebuild_cost_too_high",
      driver: null,
    });
  });

  it("refers contents of £150,000 or more", () => {
    // refer_contents_pence_min = 15,000,000
    expect(homeEligibility(home, homeInputs({ contentsValuePence: 14_999_999 }))).toBeNull();
    expect(homeEligibility(home, homeInputs({ contentsValuePence: 15_000_000 }))?.reason).toBe(
      "high_contents_value",
    );
  });

  it("refers a home built in 1749 or before", () => {
    // refer_year_built_max = 1749
    expect(homeEligibility(home, homeInputs({ yearBuilt: 1_750 }))).toBeNull();
    expect(homeEligibility(home, homeInputs({ yearBuilt: 1_749 }))?.reason).toBe("old_property");
  });

  it("refers 3 or more past claims", () => {
    expect(homeEligibility(home, homeInputs({ pastClaims: 2 }))).toBeNull();
    expect(homeEligibility(home, homeInputs({ pastClaims: 3 }))).toEqual({
      outcome: "referred",
      reason: "past_claims",
      driver: null,
    });
  });
});

describe("businessEligibility", () => {
  it("quotes an ordinary business", () => {
    expect(businessEligibility(business, businessInputs())).toBeNull();
  });

  it("refers a turnover of £5m or more", () => {
    // refer_turnover_pence_min = 500,000,000
    expect(
      businessEligibility(business, businessInputs({ turnoverPence: 499_999_999 })),
    ).toBeNull();
    expect(
      businessEligibility(business, businessInputs({ turnoverPence: 500_000_000 }))?.reason,
    ).toBe("high_turnover");
  });

  it("refers 51 or more employees", () => {
    // refer_employees_min = 51
    expect(businessEligibility(business, businessInputs({ employees: 50 }))).toBeNull();
    expect(businessEligibility(business, businessInputs({ employees: 51 }))?.reason).toBe(
      "many_employees",
    );
  });

  it("refers a band E trade with 11 or more employees", () => {
    // refer_high_risk_employees_min = 11; roofer is band E
    const roofer = (employees: number) => businessInputs({ tradeClass: "roofer", employees });
    expect(businessEligibility(business, roofer(10))).toBeNull();
    expect(businessEligibility(business, roofer(11))).toEqual({
      outcome: "referred",
      reason: "high_risk_employees",
      driver: null,
    });
    // An accountant (band A) with 11 is fine
    expect(businessEligibility(business, businessInputs({ employees: 11 }))).toBeNull();
  });
});

describe("coverAreaEligibility", () => {
  it("declines Jersey, Guernsey and the Isle of Man", () => {
    for (const area of ["JE", "GY", "IM"]) {
      expect(coverAreaEligibility(area)).toEqual({
        outcome: "declined",
        reason: "outside_cover_area",
        driver: null,
      });
    }
  });

  it("quotes a UK area", () => {
    expect(coverAreaEligibility("LS")).toBeNull();
  });
});

describe("no sensitive characteristics", () => {
  type Sensitive =
    | "sex"
    | "gender"
    | "ethnicity"
    | "religion"
    | "health"
    | "disability"
    | "nationality";

  it("isn't a field of any rating input", () => {
    expectTypeOf<Extract<keyof CarInputs["driver"], Sensitive>>().toBeNever();
    expectTypeOf<Extract<keyof CarDriver, Sensitive>>().toBeNever();
    expectTypeOf<Extract<keyof CarInputs, Sensitive>>().toBeNever();
    expectTypeOf<Extract<keyof HomeInputs, Sensitive>>().toBeNever();
    expectTypeOf<Extract<keyof BusinessInputs, Sensitive>>().toBeNever();
  });
});
