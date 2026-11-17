import { z } from "zod";

import { ageOn } from "./dates";

// The quote steps' field building blocks, shared by car (5.3) and home (5.7). Each takes its
// messages, so zod's own text never shows.

export const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const option = <T extends string>(value: T, label: string) => ({ value, label });

export const values = <T extends string>(options: { value: T }[]) =>
  options.map((o) => o.value) as [T, ...T[]];

export const isoDate = (message: string) =>
  z.string({ error: message }).regex(ISO, { error: message });

export const text = (required: string, max: number, tooLong: string) =>
  z.string({ error: required }).trim().min(1, { error: required }).max(max, { error: tooLong });

/** A whole number typed in a box; commas are allowed ("8,000") */
export const whole = (message: string, min: number, max: number, tooBig: string) =>
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

export const choice = <T extends string>(options: { value: T }[], message: string) =>
  z.enum(values(options), { error: message });

export const yesNo = (message: string) => z.boolean({ error: message });

/** A date of birth that makes the person `minAge` to 100 today */
export const dateOfBirth = (
  today: string,
  messages: { required: string; tooYoung: string; tooOld: string },
  minAge = 17,
) =>
  isoDate(messages.required).superRefine((dob, ctx) => {
    const age = ageOn(dob, today);
    if (dob > today || age < minAge) ctx.addIssue({ code: "custom", message: messages.tooYoung });
    else if (age > 100) ctx.addIssue({ code: "custom", message: messages.tooOld });
  });
