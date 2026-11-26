import { z } from "zod";

import { isOfferedExcess } from "#/features/quote/cover";
import { normalisePostcode } from "#/features/quote/postcode";
import { normalisePlate } from "#/features/quote/plate";
import { errors as driverErrors, newDriverSchema } from "#/features/quote/schemas/driver-steps";
import { text, whole } from "#/features/quote/schemas/fields";
import { homeErrors } from "#/features/quote/schemas/home-steps";
import {
  alarmTypes,
  coverLevels,
  lockTypes,
  overnightLocations,
  windowLockTypes,
} from "#/server/db/schema/values";

import type { PolicyChangeRequest } from "./request";

// A policy change as the server accepts it (6.3b, decisions 11 to 13), from the dialogs or from
// Kerbie (7.5). The driver's rules are the quote journey's named-driver step's; the car's mileage
// and the home's contents and security answers follow the journey's too (6.3c).

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
      addons: z
        .array(z.string().min(1).max(40))
        .max(10)
        .transform((addons) => [...new Set(addons)].sort()),
      voluntaryExcessPence: z
        .number()
        .int()
        .refine((pence) => isOfferedExcess(pence), { error: "Choose a voluntary excess." }),
    }),
    z.object({
      kind: z.literal("car_replaced"),
      catalogueVariantId: z.uuid(),
      registration: z
        .string()
        .max(20)
        .transform((plate) => normalisePlate(plate))
        .refine((plate) => plate.length > 0)
        .nullable(),
      currentMileage: whole(
        driverErrors.currentMileage,
        0,
        999_999,
        driverErrors.currentMileageMax,
      ),
    }),
    z
      .object({
        kind: z.literal("home_contents"),
        // The journey's pounds, sent as pence
        contentsValuePence: z
          .number({ error: homeErrors.contentsValue })
          .int({ error: homeErrors.contentsValue })
          .min(500_000, { error: homeErrors.contentsValue })
          .max(50_000_000, { error: homeErrors.contentsValue })
          .refine((pence) => pence % 100 === 0, { error: homeErrors.contentsValue }),
        valuablesPence: z
          .number({ error: homeErrors.valuables })
          .int({ error: homeErrors.valuables })
          .min(0, { error: homeErrors.valuables })
          .max(50_000_000, { error: homeErrors.valuablesOverContents })
          .refine((pence) => pence % 100 === 0, { error: homeErrors.valuables }),
      })
      .refine((value) => value.valuablesPence <= value.contentsValuePence, {
        path: ["valuablesPence"],
        error: homeErrors.valuablesOverContents,
      }),
    z.object({
      kind: z.literal("home_security"),
      lockType: z.enum(lockTypes, { error: homeErrors.lockType }),
      windowLocks: z.enum(windowLockTypes, { error: homeErrors.windowLocks }),
      alarmType: z.enum(alarmTypes, { error: homeErrors.alarm }),
      hasSmokeAlarm: z.boolean(),
    }),
  ]) as z.ZodType<PolicyChangeRequest, unknown>;
