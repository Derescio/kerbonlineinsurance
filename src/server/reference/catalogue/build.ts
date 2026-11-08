import type { FuelType, Transmission } from "#/server/db/schema/values";

import type { VariantSource } from "./types";

/**
 * One variant, written as a table row: name, fuel, gearbox, doors, engine cc (null for electric),
 * bhp, insurance group (1–50), new price in pounds, and optionally the years it was sold within
 * its generation.
 */
export function v(
  name: string,
  fuelType: FuelType,
  transmission: Transmission,
  doors: number,
  engineCc: number | null,
  powerBhp: number,
  insuranceGroup: number,
  newPricePounds: number,
  years?: [number, number],
): VariantSource {
  return {
    name,
    fuelType,
    transmission,
    doors,
    engineCc,
    powerBhp,
    insuranceGroup,
    newPricePence: newPricePounds * 100,
    ...(years ? { years } : {}),
  };
}

/** The usual note: groups as published for the generation, with any spot checks named. */
export const PUBLISHED = (generation: string, checked?: string) =>
  `Published 1–50 groups for the ${generation} (Parkers, Honest John)${checked ? `; checked: ${checked}` : ""}`;
