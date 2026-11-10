import { describe, expect, it } from "vite-plus/test";

import {
  findCar,
  fuelLabel,
  makesOf,
  modelsOf,
  type PickerCar,
  variantsOf,
  yearsOf,
} from "./catalogue";

const car = (make: string, model: string, year: number, variant: string): PickerCar => ({
  id: `${make}-${model}-${year}-${variant}`,
  make,
  model,
  year,
  variant,
  fuelType: "petrol",
  doors: 5,
  transmission: "manual",
});

const cars = [
  car("Volkswagen", "Polo", 2020, "1.0 Life 5dr"),
  car("Ford", "Fiesta", 2019, "1.1 Zetec 5dr"),
  car("Volkswagen", "Golf", 2020, "1.0 TSI Life 5dr"),
  car("Volkswagen", "Golf", 2021, "GTI 5dr"),
  car("Volkswagen", "Golf", 2021, "1.0 TSI Life 5dr"),
];

describe("the picker cascade", () => {
  it("lists makes A to Z, once each", () => {
    expect(makesOf(cars)).toEqual(["Ford", "Volkswagen"]);
  });

  it("lists a make's models A to Z", () => {
    expect(modelsOf(cars, "Volkswagen")).toEqual(["Golf", "Polo"]);
  });

  it("lists a model's years newest first", () => {
    expect(yearsOf(cars, "Volkswagen", "Golf")).toEqual([2021, 2020]);
  });

  it("lists only that make, model and year's variants, A to Z", () => {
    expect(variantsOf(cars, "Volkswagen", "Golf", 2021).map((c) => c.variant)).toEqual([
      "1.0 TSI Life 5dr",
      "GTI 5dr",
    ]);
  });

  it("finds the exact car, or nothing", () => {
    const golf = { make: "Volkswagen", model: "Golf", year: 2021, variant: "GTI 5dr" };
    expect(findCar(cars, golf)?.id).toBe("Volkswagen-Golf-2021-GTI 5dr");
    expect(findCar(cars, { ...golf, variant: "R 5dr" })).toBeNull();
  });

  it("shows the fuel with a capital", () => {
    expect(fuelLabel("electric")).toBe("Electric");
  });
});
