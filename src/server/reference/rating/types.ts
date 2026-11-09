import { z } from "zod";

import { coverLevels, lookupKinds, products } from "#/server/db/schema/values";

// One rating version as typed source (4.8, call 20). The deploy's upsert writes it to the five
// rating tables; contentHash() fingerprints it, so a version can never change once deployed.

const pence = z.number().int().nonnegative();

export const ratingSourceSchema = z.object({
  product: z.enum(products),
  version: z.number().int().positive(),
  effectiveFrom: z.iso.date(),
  notes: z.string().min(1),
  parameters: z.record(z.string().min(1), z.number().finite()),
  tiers: z.array(
    z.object({
      coverLevel: z.enum(coverLevels),
      multiplier: z.number(),
      compulsoryExcessPence: pence,
    }),
  ),
  addons: z.array(
    z.object({
      addon: z.string().min(1),
      annualPricePence: pence.positive(),
      factors: z.array(z.string().min(1)),
      availableToGroups: z.array(z.string().min(1)).nullable(),
    }),
  ),
  factors: z.array(
    z.object({
      factor: z.string().min(1),
      band: z.string().min(1),
      rangeFrom: z.number().int().nullable(),
      rangeTo: z.number().int().nullable(),
      multiplier: z.number(),
    }),
  ),
  lookups: z.array(
    z.object({
      lookup: z.enum(lookupKinds),
      factor: z.string().min(1),
      key: z.string().min(1),
      label: z.string().min(1),
      group: z.string().min(1).nullable(),
      band: z.string().min(1),
    }),
  ),
});

export type RatingSource = z.infer<typeof ratingSourceSchema>;
export type RatingFactor = RatingSource["factors"][number];
export type RatingLookup = RatingSource["lookups"][number];
