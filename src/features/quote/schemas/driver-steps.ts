import { z } from "zod";

import {
  HIDDEN_FROM_JOBS,
  isJobStatus,
  occupationFor,
  statusOptions,
  type EmploymentStatus,
} from "../occupation";
import { addYears, ageOn, wholeYearsBetween } from "./dates";

// The car journey's driver steps (5.3): about you, licence and driving, claims and named drivers.
// Each schema takes today (London, `todayIso()`), because ages and the 5-year window move with it;
// stepState() re-runs them on stored answers (call 16). Every message is set here, so zod's own
// text never shows, and none repeats what was typed (4.5c). 5.6 parses the same schemas on save.

export const errors = {
  firstName: "Enter your first name.",
  lastName: "Enter your last name.",
  addressLine1: "Enter the first line of your address.",
  town: "Enter your town or city.",
  max50: "Enter no more than 50 characters.",
  max100: "Enter no more than 100 characters.",
  status: "Choose your employment status.",
  occupation: "Choose your occupation.",
  licenceType: "Choose a licence type.",
  noClaimsYears: "Choose how many years of no-claims discount you have.",
  usage: "Choose how the car is used.",
  overnight: "Choose where the car is kept overnight.",
  incidentType: "Choose the type of incident.",
  fault: "Choose who was at fault.",
  relationship: "Choose their relationship to you.",
  howMany: "Choose how many.",
  yesNo: "Answer yes or no.",
  confirmed: "Confirm your driving history to continue.",
  dateOfBirth: "Enter a date of birth.",
  licenceDate: "Enter the date your full licence was obtained.",
  incidentDate: "Enter the date of the incident.",
  under17: "You must be 17 or over to get a quote.",
  namedUnder17: "Named drivers must be 17 or over.",
  over100: "Check the year of birth.",
  namedProvisional: "A named driver needs a full licence.",
  licenceBefore17: "The licence date can’t be before your 17th birthday.",
  namedLicenceBefore17: "The licence date can’t be before their 17th birthday.",
  licenceFuture: "The licence date can’t be in the future.",
  provisional: "Kerb can’t quote for a provisional licence yet.",
  noClaimsTooMany: "Your no-claims years can’t be more than the years you’ve held a licence.",
  incidentOld: "The incident must be in the last 5 years.",
  incidentFuture: "The incident date can’t be in the future.",
  annualMileageMax: "Enter a mileage up to 100,000.",
  currentMileageMax: "Enter a mileage up to 999,999.",
  costMax: "Enter a cost up to £1,000,000.",
  annualMileage: "Enter the annual mileage in whole miles.",
  currentMileage: "Enter the current mileage in whole miles.",
  cost: "Enter the cost in whole pounds.",
  noIncidents: "Add the incident, or answer no.",
  tooManyIncidents: "You can add up to 10 incidents.",
  incidentsWithNo: "Remove the incidents, or answer yes.",
  noDrivers: "Add a named driver, or answer no.",
  tooManyDrivers: "You can add up to 4 named drivers.",
  driversWithNo: "Remove the named drivers, or answer yes.",
} as const;

// --- Options (the stored values and their labels) -------------------------------------------

const option = <T extends string>(value: T, label: string) => ({ value, label });

export const licenceOptions = [
  option("full_uk", "Full UK"),
  option("full_eu", "Full EU or EEA"),
  option("provisional", "Provisional UK"),
];
export const usageOptions = [
  option("social", "Social, domestic and pleasure"),
  option("commuting", "Social, domestic and commuting"),
  option("business", "Business use"),
];
export const overnightOptions = [
  option("garage", "Garage"),
  option("driveway", "Driveway"),
  option("street", "On the street"),
];
export const incidentTypeOptions = [
  option("collision", "Collision"),
  option("theft", "Theft"),
  option("fire", "Fire"),
  option("vandalism", "Vandalism"),
  option("windscreen", "Windscreen"),
  option("other", "Other"),
];
export const faultOptions = [
  option("at_fault", "At fault"),
  option("not_at_fault", "Not at fault"),
  option("undecided", "Fault not yet decided"),
];
export const relationshipOptions = [
  option("spouse", "Spouse or civil partner"),
  option("partner", "Partner"),
  option("parent", "Parent"),
  option("child", "Son or daughter"),
  option("sibling", "Brother or sister"),
  option("other_relative", "Other relative"),
  option("friend", "Friend or colleague"),
];
/** 9 means "9 or more": v1 rates 9+ the same */
export const noClaimsOptions = Array.from({ length: 10 }, (_, n) => ({
  value: String(n),
  label: n === 9 ? "9 or more years" : n === 1 ? "1 year" : `${n} years`,
}));
/** A named driver's claims; 5 means "5 or more" */
export const claimsCountOptions = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: n === 5 ? "5 or more" : String(n),
}));

const values = <T extends string>(options: { value: T }[]) =>
  options.map((o) => o.value) as [T, ...T[]];

export type FullLicence = "full_uk" | "full_eu";
export type Usage = "social" | "commuting" | "business";
export type Overnight = "garage" | "driveway" | "street";
export type IncidentType = (typeof incidentTypeOptions)[number]["value"];
export type Fault = (typeof faultOptions)[number]["value"];
export type Relationship = (typeof relationshipOptions)[number]["value"];

// --- Building blocks ----------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (message: string) => z.string({ error: message }).regex(ISO, { error: message });

const text = (required: string, max: number, tooLong: string) =>
  z.string({ error: required }).trim().min(1, { error: required }).max(max, { error: tooLong });

/** A whole number typed in a box; commas are allowed ("8,000") */
const whole = (message: string, min: number, max: number, tooBig: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const digits = value.replace(/,/g, "").trim();
      return /^\d+$/.test(digits) ? Number(digits) : undefined;
    },
    z
      .number({ error: message })
      .int({ error: message })
      .min(min, { error: message })
      .max(max, { error: tooBig }),
  );

const choice = <T extends string>(options: { value: T }[], message: string) =>
  z.enum(values(options), { error: message });

const yesNo = z.boolean({ error: errors.yesNo });

const status = z.enum(values(statusOptions), { error: errors.status });

/** A date of birth that makes the driver 17 to 100 today */
const dateOfBirth = (today: string, under17: string) =>
  isoDate(errors.dateOfBirth).superRefine((dob, ctx) => {
    const age = ageOn(dob, today);
    if (dob > today || age < 17) ctx.addIssue({ code: "custom", message: under17 });
    else if (age > 100) ctx.addIssue({ code: "custom", message: errors.over100 });
  });

/** A full licence date that isn't in the future; the 17th birthday is checked on the object */
const licenceDate = (today: string) =>
  isoDate(errors.licenceDate).refine((date) => date <= today, { error: errors.licenceFuture });

/** The occupation must be the status's fixed key, or a job a working status may choose */
function checkOccupation(
  value: { status: EmploymentStatus; occupation?: string },
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  const { status: s, occupation } = value;
  const ok = isJobStatus(s)
    ? !!occupation &&
      (!HIDDEN_FROM_JOBS.includes(occupation) ||
        (s === "self_employed" && occupation === "self_employed"))
    : occupation === occupationFor(s, occupation);
  if (!ok)
    ctx.addIssue({ code: "custom", path: [...path, "occupation"], message: errors.occupation });
}

function checkLicenceAge(
  value: { licenceDate: string },
  dob: string | undefined,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  if (dob && ISO.test(dob) && value.licenceDate < addYears(dob, 17)) {
    ctx.addIssue({ code: "custom", path: [...path, "licenceDate"], message });
  }
}

// --- About you ----------------------------------------------------------------------------

export const aboutYouSchema = (today: string) =>
  z
    .object({
      firstName: text(errors.firstName, 50, errors.max50),
      lastName: text(errors.lastName, 50, errors.max50),
      dateOfBirth: dateOfBirth(today, errors.under17),
      status,
      occupation: z.string().optional(),
      addressLine1: text(errors.addressLine1, 100, errors.max100),
      addressLine2: z
        .string()
        .trim()
        .max(100, { error: errors.max100 })
        .optional()
        .transform((line) => line || undefined),
      town: text(errors.town, 100, errors.max100),
    })
    .superRefine((value, ctx) => checkOccupation(value, ctx, []))
    .transform((value) => ({ ...value, occupation: value.occupation! }));

export type AboutYou = z.output<ReturnType<typeof aboutYouSchema>>;

// --- Licence and driving ------------------------------------------------------------------

export const licenceSchema = (today: string, dob: string | undefined) =>
  z
    .object({
      licenceType: choice(licenceOptions, errors.licenceType)
        .refine((type) => type !== "provisional", { error: errors.provisional })
        .transform((type) => type as FullLicence),
      licenceDate: licenceDate(today),
      noClaimsYears: whole(errors.noClaimsYears, 0, 9, errors.noClaimsYears),
      annualMileage: whole(errors.annualMileage, 1, 100_000, errors.annualMileageMax),
      currentMileage: whole(errors.currentMileage, 0, 999_999, errors.currentMileageMax),
      usage: choice(usageOptions, errors.usage),
      overnight: choice(overnightOptions, errors.overnight),
    })
    .superRefine((value, ctx) => {
      checkLicenceAge(value, dob, ctx, [], errors.licenceBefore17);
      // 9 means "9 or more", so 9 is fine once 9 years have passed
      if (value.noClaimsYears > wholeYearsBetween(value.licenceDate, today)) {
        ctx.addIssue({ code: "custom", path: ["noClaimsYears"], message: errors.noClaimsTooMany });
      }
    });

export type LicenceAndUsage = z.output<ReturnType<typeof licenceSchema>>;

// --- Claims -------------------------------------------------------------------------------

const incident = (today: string) =>
  z.object({
    id: z.string().min(1),
    date: isoDate(errors.incidentDate).superRefine((date, ctx) => {
      if (date > today) ctx.addIssue({ code: "custom", message: errors.incidentFuture });
      else if (date < addYears(today, -5)) {
        ctx.addIssue({ code: "custom", message: errors.incidentOld });
      }
    }),
    type: choice(incidentTypeOptions, errors.incidentType),
    fault: choice(faultOptions, errors.fault),
    costPounds: whole(errors.cost, 0, 1_000_000, errors.costMax),
  });

export const claimsSchema = (today: string) =>
  z
    .object({
      any: yesNo,
      incidents: z.array(incident(today)).max(10, { error: errors.tooManyIncidents }),
      confirmed: z.literal(true, { error: errors.confirmed }),
    })
    .superRefine(({ any, incidents }, ctx) => {
      if (any && incidents.length === 0) {
        ctx.addIssue({ code: "custom", path: ["incidents"], message: errors.noIncidents });
      }
      if (!any && incidents.length > 0) {
        ctx.addIssue({ code: "custom", path: ["incidents"], message: errors.incidentsWithNo });
      }
    });

export type Claims = z.output<ReturnType<typeof claimsSchema>>;
export type Incident = Claims["incidents"][number];

// --- Named drivers ------------------------------------------------------------------------

const namedDriver = (today: string) =>
  z.object({
    id: z.string().min(1),
    firstName: text(errors.firstName, 50, errors.max50),
    lastName: text(errors.lastName, 50, errors.max50),
    dateOfBirth: dateOfBirth(today, errors.namedUnder17),
    relationship: choice(relationshipOptions, errors.relationship),
    status,
    occupation: z.string().optional(),
    licenceType: choice(licenceOptions, errors.licenceType)
      .refine((type) => type !== "provisional", { error: errors.namedProvisional })
      .transform((type) => type as FullLicence),
    licenceDate: licenceDate(today),
    anyClaims: yesNo,
    /** 0 for no; 1 to 5 ("5 or more") for yes */
    pastClaims: whole(errors.howMany, 0, 5, errors.howMany),
  });

export const namedDriversSchema = (today: string) =>
  z
    .object({
      any: yesNo,
      drivers: z.array(namedDriver(today)).max(4, { error: errors.tooManyDrivers }),
    })
    .superRefine(({ any, drivers }, ctx) => {
      if (any && drivers.length === 0) {
        ctx.addIssue({ code: "custom", path: ["drivers"], message: errors.noDrivers });
      }
      if (!any && drivers.length > 0) {
        ctx.addIssue({ code: "custom", path: ["drivers"], message: errors.driversWithNo });
      }
      drivers.forEach((driver, i) => {
        const path = ["drivers", i];
        checkOccupation(driver, ctx, path);
        checkLicenceAge(driver, driver.dateOfBirth, ctx, path, errors.namedLicenceBefore17);
        if (driver.anyClaims !== driver.pastClaims > 0) {
          ctx.addIssue({ code: "custom", path: [...path, "pastClaims"], message: errors.howMany });
        }
      });
    })
    .transform((value) => ({
      ...value,
      drivers: value.drivers.map((d) => ({ ...d, occupation: d.occupation! })),
    }));

export type NamedDrivers = z.output<ReturnType<typeof namedDriversSchema>>;
export type NamedDriver = NamedDrivers["drivers"][number];
