import { z } from "zod";

import { isOfferedExcess } from "#/features/quote/cover";
import { normalisePostcode } from "#/features/quote/postcode";
import { newDriverSchema } from "#/features/quote/schemas/driver-steps";
import { text } from "#/features/quote/schemas/fields";
import { coverLevels, overnightLocations } from "#/server/db/schema/values";

import type { PolicyChangeRequest } from "./request";

// A policy change as the server accepts it (6.3b, decisions 11 to 13), from the dialogs or from
// Kerbie (7.5). The driver's rules are the quote journey's named-driver step's.

export const ENTER_POSTCODE = "Enter a full UK postcode, like N16 7HB.";

export const policyChangeSchema = (today: string): z.ZodType<PolicyChangeRequest, unknown> =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("address"),
      postcode: z
        .string()
        .transform((value) => normalisePostcode(value))
        .refine((value): value is string => value !== null, { error: ENTER_POSTCODE })
        .transform((value) => value!),
      addressLine1: text("Choose your address.", 100, "Use up to 100 characters."),
      addressLine2: z.string().trim().max(100).nullable(),
      town: text("Enter your town.", 60, "Use up to 60 characters."),
      overnightLocation: z.enum(overnightLocations, {
        error: "Choose where the car is parked overnight.",
      }),
    }),
    z.object({ kind: z.literal("driver_added"), driver: newDriverSchema(today) }),
    z.object({ kind: z.literal("driver_removed"), driverId: z.uuid() }),
    z.object({
      kind: z.literal("cover"),
      coverLevel: z.enum(coverLevels),
      addons: z.array(z.string().min(1).max(40)).max(10),
      voluntaryExcessPence: z
        .number()
        .int()
        .refine((pence) => isOfferedExcess(pence), { error: "Choose a voluntary excess." }),
    }),
  ]) as z.ZodType<PolicyChangeRequest, unknown>;
