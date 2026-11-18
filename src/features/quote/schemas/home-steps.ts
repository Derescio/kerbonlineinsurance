import { z } from "zod";

import { addYears } from "./dates";
import { checkOccupation, errors, status } from "./driver-steps";
import { choice, dateOfBirth, isoDate, option, text, whole, yesNo } from "./fields";

// The home journey's steps (5.7, decisions 3–6): about you, the property, contents and security,
// and past claims. Like car's (5.3), each schema that moves with the date takes today, and
// homeStepState() re-runs them on stored answers. Money is typed in whole pounds; the save turns
// it into pence. Car's messages are reused where the question is the same.

export const homeErrors = {
  under18: "You must be 18 or over to get a home quote.",
  valuablesOverContents:
    "Valuables are part of your contents, so they can’t be more than the contents total.",
  rebuildCost: "Enter a rebuild cost between £50,000 and £5,000,000.",
  contentsValue: "Enter a contents value between £5,000 and £500,000.",
  bedrooms: "Choose the number of bedrooms.",
  propertyType: "Choose the property type.",
  lockType: "Choose the main door lock.",
  windowLocks: "Choose the window locks.",
  alarm: "Choose the burglar alarm.",
  claimType: "Choose the type of claim.",
  claimStatus: "Choose the claim status.",
  amount: "Enter the amount in whole pounds.",
  amountMax: "Enter an amount up to £1,000,000.",
  tooManyClaims: "You can add up to 5 claims.",
  noClaims: "Add the claim, or answer no.",
  claimsWithNo: "Remove the claims, or answer yes.",
  confirmed: "Confirm your details to continue.",
  address: "Choose your address, or enter it manually.",
  valuables: "Enter the valuables total in whole pounds.",
  yearBuilt: (thisYear: number) => `Enter a year between 1500 and ${thisYear}.`,
} as const;

// --- Options (the stored values and their labels) -------------------------------------------

export const propertyTypeOptions = [
  option("detached", "Detached house"),
  option("semi", "Semi-detached house"),
  option("terraced", "Terraced house"),
  option("flat", "Flat"),
  option("bungalow", "Bungalow"),
];
export const lockTypeOptions = [
  option("standard", "Standard lock or night latch"),
  option("five_lever", "Five-lever mortice deadlock"),
  option("multipoint", "Multi-point locking system"),
];
export const windowLockOptions = [
  option("all_accessible", "Locks on all accessible windows"),
  option("some", "Locks on some windows"),
  option("none", "No window locks"),
];
export const alarmOptions = [
  option("none", "No alarm"),
  option("installed_unmonitored", "Professionally installed, not monitored"),
  option("monitored", "Professionally installed and monitored"),
];
export const homeClaimTypeOptions = [
  option("escape_of_water", "Escape of water"),
  option("theft", "Theft"),
  option("accidental_damage", "Accidental damage"),
  option("storm_flood", "Storm or flood"),
  option("fire", "Fire"),
  option("subsidence", "Subsidence"),
  option("other", "Other"),
];
export const claimStatusOptions = [
  option("settled", "Settled"),
  option("open", "Open"),
  option("withdrawn", "Withdrawn"),
];

export type PropertyType = (typeof propertyTypeOptions)[number]["value"];
export type LockType = (typeof lockTypeOptions)[number]["value"];
export type WindowLocks = (typeof windowLockOptions)[number]["value"];
export type Alarm = (typeof alarmOptions)[number]["value"];
export type HomeClaimType = (typeof homeClaimTypeOptions)[number]["value"];
export type ClaimStatus = (typeof claimStatusOptions)[number]["value"];

// --- About you ----------------------------------------------------------------------------

export const homeAboutSchema = (today: string) =>
  z
    .object({
      firstName: text(errors.firstName, 50, errors.max50),
      lastName: text(errors.lastName, 50, errors.max50),
      // A home policy is a contract, so 18, not car's 17 (decision 3)
      dateOfBirth: dateOfBirth(
        today,
        { required: errors.dateOfBirth, tooYoung: homeErrors.under18, tooOld: errors.over100 },
        18,
      ),
      // Rated by home v2, asked as car's About you asks them (5.7c, decision 3)
      status,
      occupation: z.string().optional(),
    })
    .superRefine((value, ctx) => checkOccupation(value, ctx, []))
    .transform((value) => ({ ...value, occupation: value.occupation! }));

export type HomeAbout = z.output<ReturnType<typeof homeAboutSchema>>;

// --- Property -----------------------------------------------------------------------------

const address = z
  .object(
    {
      line1: text(errors.addressLine1, 100, errors.max100),
      line2: z
        .string()
        .trim()
        .max(100, { error: errors.max100 })
        .optional()
        .transform((line) => line || undefined),
      town: text(errors.town, 100, errors.max100),
      /** From the address list, not typed in (decision 4) */
      picked: z.boolean(),
    },
    { error: homeErrors.address },
  )
  // An empty second line is left out, as the stored part expects
  .transform(({ line2, ...rest }) => ({ ...rest, ...(line2 && { line2 }) }));

export const propertySchema = (thisYear: number) =>
  z.object({
    address,
    propertyType: choice(propertyTypeOptions, homeErrors.propertyType),
    yearBuilt: whole(
      homeErrors.yearBuilt(thisYear),
      1500,
      thisYear,
      homeErrors.yearBuilt(thisYear),
    ),
    /** 0 is a studio */
    bedrooms: whole(homeErrors.bedrooms, 0, 10, homeErrors.bedrooms),
    rebuildCostPounds: whole(homeErrors.rebuildCost, 50_000, 5_000_000, homeErrors.rebuildCost),
  });

export type PropertyAnswers = z.output<ReturnType<typeof propertySchema>>;

// --- Contents and security ----------------------------------------------------------------

export const contentsSchema = z
  .object({
    contentsValuePounds: whole(homeErrors.contentsValue, 5_000, 500_000, homeErrors.contentsValue),
    valuablesPounds: whole(homeErrors.valuables, 0, 500_000, homeErrors.valuablesOverContents),
    lockType: choice(lockTypeOptions, homeErrors.lockType),
    windowLocks: choice(windowLockOptions, homeErrors.windowLocks),
    alarm: choice(alarmOptions, homeErrors.alarm),
    smokeAlarm: z.boolean(),
  })
  // Checked whenever both amounts are numbers, even while other answers are missing
  .refine((value) => value.valuablesPounds <= value.contentsValuePounds, {
    path: ["valuablesPounds"],
    message: homeErrors.valuablesOverContents,
    when: (payload) => {
      const v = payload.value as { valuablesPounds?: unknown; contentsValuePounds?: unknown };
      return typeof v.valuablesPounds === "number" && typeof v.contentsValuePounds === "number";
    },
  });

export type ContentsAnswers = z.output<typeof contentsSchema>;

// --- Past claims --------------------------------------------------------------------------

const homeClaim = (today: string) =>
  z.object({
    id: z.string().min(1),
    date: isoDate(errors.incidentDate).superRefine((date, ctx) => {
      if (date > today) ctx.addIssue({ code: "custom", message: errors.incidentFuture });
      else if (date < addYears(today, -5)) {
        ctx.addIssue({ code: "custom", message: errors.incidentOld });
      }
    }),
    type: choice(homeClaimTypeOptions, homeErrors.claimType),
    amountPounds: whole(homeErrors.amount, 0, 1_000_000, homeErrors.amountMax),
    status: choice(claimStatusOptions, homeErrors.claimStatus),
  });

export const homeClaimsSchema = (today: string) =>
  z
    .object({
      any: yesNo(errors.yesNo),
      claims: z.array(homeClaim(today)).max(5, { error: homeErrors.tooManyClaims }),
      confirmed: z.literal(true, { error: homeErrors.confirmed }),
    })
    .superRefine(({ any, claims }, ctx) => {
      if (any && claims.length === 0) {
        ctx.addIssue({ code: "custom", path: ["claims"], message: homeErrors.noClaims });
      }
      if (!any && claims.length > 0) {
        ctx.addIssue({ code: "custom", path: ["claims"], message: homeErrors.claimsWithNo });
      }
    });

export type HomeClaims = z.output<ReturnType<typeof homeClaimsSchema>>;
export type HomeClaim = HomeClaims["claims"][number];

/** "Terraced house" for a stored property type; the key itself for one this list doesn't know */
export function propertyTypeLabel(value: string): string {
  return propertyTypeOptions.find((o) => o.value === value)?.label ?? value;
}
