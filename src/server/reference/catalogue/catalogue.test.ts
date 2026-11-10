import { describe, expect, it } from "vite-plus/test";

import { expandCatalogue } from "./expand";
import { CATALOGUE_SOURCES } from "./index";
import { demoPlates } from "#/features/quote/demo-plates";

const rows = expandCatalogue(CATALOGUE_SOURCES);
const models = new Set(rows.map((r) => `${r.make} ${r.model}`));
const variantsOf = (make: string, model: string) =>
  rows.filter((r) => r.make === make && r.model === model);

// The spec's everyday models (41) and the two prestige models
const EVERYDAY = [
  "Ford Fiesta",
  "Ford Focus",
  "Ford Puma",
  "Ford Kuga",
  "Vauxhall Corsa",
  "Vauxhall Astra",
  "Vauxhall Mokka",
  "Volkswagen Golf",
  "Volkswagen Polo",
  "Volkswagen T-Roc",
  "Volkswagen Tiguan",
  "Volkswagen ID.3",
  "Nissan Qashqai",
  "Nissan Juke",
  "Nissan Micra",
  "Nissan Leaf",
  "Toyota Yaris",
  "Toyota Corolla",
  "Toyota C-HR",
  "Kia Sportage",
  "Kia Niro",
  "Kia Picanto",
  "Hyundai Tucson",
  "Hyundai i10",
  "Hyundai Kona",
  "Peugeot 208",
  "Peugeot 2008",
  "Peugeot 3008",
  "MG HS",
  "MG ZS",
  "MG MG4",
  "BMW 1 Series",
  "BMW 3 Series",
  "Mercedes-Benz A-Class",
  "Audi A3",
  "MINI Hatch",
  "Skoda Octavia",
  "Renault Clio",
  "Dacia Sandero",
  "Tesla Model 3",
  "Tesla Model Y",
];

describe("CATALOGUE_SOURCES", () => {
  it("expands to between 1,500 and 3,500 rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1_500);
    expect(rows.length).toBeLessThanOrEqual(3_500);
  });

  it("has the 41 everyday models and the two prestige models", () => {
    expect(EVERYDAY).toHaveLength(41);
    for (const model of [...EVERYDAY, "Porsche 911", "Land Rover Range Rover Sport"]) {
      expect(models.has(model), model).toBe(true);
    }
  });

  it.each([
    ["BMW", "3 Series", "M3"],
    ["Mercedes-Benz", "A-Class", "A 45 S"],
    ["Audi", "A3", "RS 3"],
    ["Volkswagen", "Golf", "Golf R"],
    ["Volkswagen", "Golf", "GTI"],
    ["Ford", "Focus", "ST"],
    ["Ford", "Fiesta", "ST"],
    ["Tesla", "Model 3", "Performance"],
  ])("has the %s %s %s performance trim", (make, model, trim) => {
    expect(variantsOf(make, model).some((r) => r.variant.includes(trim))).toBe(true);
  });

  it("keeps production ranges", () => {
    expect(variantsOf("Ford", "Fiesta").every((r) => r.year <= 2023)).toBe(true);
    expect(variantsOf("Ford", "Puma").every((r) => r.year >= 2020)).toBe(true);
  });

  // The cars that make the referral and decline rules visible (decision 3): at least one variant
  // of each is in group 45 or above
  it.each([
    ["BMW", "3 Series"],
    ["Mercedes-Benz", "A-Class"],
    ["Porsche", "911"],
    ["Land Rover", "Range Rover Sport"],
    ["Tesla", "Model 3"],
  ])("%s %s reaches group 45+", (make, model) => {
    expect(
      Math.max(...variantsOf(make, model).map((r) => r.insuranceGroup)),
    ).toBeGreaterThanOrEqual(45);
  });

  it("names a source for every generation's groups", () => {
    for (const make of CATALOGUE_SOURCES) {
      for (const generation of make.generations) {
        expect(generation.groupSource, `${make.make} ${generation.model}`).not.toBe("");
      }
    }
  });
});

describe("the demo plates (5.2, call 6)", () => {
  it("each name exactly one catalogue row", () => {
    for (const plate of demoPlates) {
      const matches = rows.filter(
        (r) =>
          r.make === plate.make &&
          r.model === plate.model &&
          r.year === plate.year &&
          r.variant === plate.variant,
      );
      expect(matches, plate.plate).toHaveLength(1);
    }
  });
});
