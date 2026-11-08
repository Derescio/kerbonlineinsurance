import { z } from "zod";

import { bodyStyles, fuelTypes, transmissions } from "#/server/db/schema/values";

// The vehicle catalogue as typed source (4.8, call 20): one file per make, listing model
// generations and their variants. expandCatalogue() turns it into one row per variant per year.

export const curves = ["standard", "electric", "prestige"] as const;
export type Curve = (typeof curves)[number];

const yearRange = z.tuple([z.number().int(), z.number().int()]);

const variantSchema = z.object({
  /** As shown in the picker, e.g. "1.0 EcoBoost Titanium 5dr" */
  name: z.string().min(1),
  fuelType: z.enum(fuelTypes),
  transmission: z.enum(transmissions),
  doors: z.number().int().min(2).max(7),
  // smallint columns
  engineCc: z.number().int().positive().max(32_767).nullable(),
  powerBhp: z.number().int().positive().max(32_767),
  insuranceGroup: z.number().int().min(1).max(50),
  newPricePence: z
    .number()
    .int()
    .positive()
    .max(2 ** 31 - 1),
  /** Narrows the generation's years */
  years: yearRange.optional(),
});

const generationSchema = z.object({
  model: z.string().min(1),
  bodyStyle: z.enum(bodyStyles),
  curve: z.enum(curves),
  years: yearRange,
  /** Where the insurance groups came from (call 6) */
  groupSource: z.string().min(1),
  variants: z.array(variantSchema).min(1),
});

export const makeSourceSchema = z.object({
  make: z.string().min(1),
  generations: z.array(generationSchema).min(1),
});

export type VariantSource = z.input<typeof variantSchema>;
export type Generation = z.input<typeof generationSchema>;
export type MakeSource = z.input<typeof makeSourceSchema>;

export interface CatalogueRow {
  make: string;
  model: string;
  year: number;
  variant: string;
  bodyStyle: (typeof bodyStyles)[number];
  fuelType: (typeof fuelTypes)[number];
  transmission: (typeof transmissions)[number];
  doors: number;
  engineCc: number | null;
  powerBhp: number;
  insuranceGroup: number;
  valuePence: number;
}
