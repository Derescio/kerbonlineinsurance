import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { signInSchema } from "#/features/auth/schemas";

import { CHECK_FIELDS, fieldErrors, parseInput, rejected } from "./validation";

const schema = z.object({
  postcode: z.string().min(1, "Enter your postcode."),
  vehicle: z.object({ registration: z.string().min(1, "Enter the registration.") }),
  drivers: z.array(z.object({ dateOfBirth: z.iso.date("Enter a date of birth.") })),
  cover: z.enum(["comprehensive", "third_party"]),
});

const valid = {
  postcode: "AB1 2CD",
  vehicle: { registration: "AB12 CDE" },
  drivers: [{ dateOfBirth: "1990-01-01" }],
  cover: "comprehensive",
};

function failure(s: z.ZodType, raw: unknown) {
  const result = parseInput(s, raw);
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("parseInput", () => {
  it("keys nested issues by dotted path", () => {
    const error = failure(schema, {
      postcode: "",
      vehicle: { registration: "" },
      drivers: [{ dateOfBirth: "x" }],
      cover: "comprehensive",
    });
    expect(error.code).toBe("VALIDATION");
    expect(error.fields).toEqual({
      postcode: "Enter your postcode.",
      "vehicle.registration": "Enter the registration.",
      "drivers.0.dateOfBirth": "Enter a date of birth.",
    });
    expect(error.message).toBe(CHECK_FIELDS);
  });

  it("keeps the first issue per field", () => {
    const s = z.object({ postcode: z.string().min(1, "first").min(3, "second") });
    expect(failure(s, { postcode: "" }).fields.postcode).toBe("first");
  });

  it("uses a root issue as the message", () => {
    const s = schema.refine(() => false, { message: "Pick a start date after today." });
    const error = failure(s, valid);
    expect(error.message).toBe("Pick a start date after today.");
    expect(error.fields).toEqual({});
  });

  it("gives plain defaults for missing and wrong values", () => {
    expect(failure(schema, {}).fields.vehicle).toBe("This field is required.");
    expect(failure(schema, { ...valid, cover: "zzz-typed" }).fields.cover).toBe(
      "Check this field.",
    );
  });

  it("never echoes input or zod's technical wording", () => {
    const error = failure(schema, { ...valid, cover: "zzz-typed", vehicle: 5 });
    expect(JSON.stringify(error)).not.toContain("zzz-typed");
    for (const message of [error.message, ...Object.values(error.fields)]) {
      expect(message).not.toMatch(/expected|received|invalid input/i);
    }
  });

  it("returns parsed data when valid", () => {
    expect(parseInput(schema, valid)).toEqual({ ok: true, data: valid });
  });
});

describe("fieldErrors", () => {
  it("matches the auth form behaviour", () => {
    const result = fieldErrors(signInSchema, { email: "", password: "" });
    expect(result.data).toBeNull();
    expect(result.errors).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });
    expect(result.data === null && result.message).toBe(CHECK_FIELDS);
  });

  it("keeps the message of a root-only failure", () => {
    const rootOnly = z
      .object({ start: z.string() })
      .refine((v) => v.start > "2030", { error: "Pick a start date after today." });
    const result = fieldErrors(rootOnly, { start: "2020" });
    expect(result.data).toBeNull();
    expect(result.errors).toEqual({});
    expect(result.data === null && result.message).toBe("Pick a start date after today.");
  });
});

describe("rejected", () => {
  it("wraps a sentence as a validation failure", () => {
    expect(rejected("This quote has expired.").error).toEqual({
      code: "VALIDATION",
      message: "This quote has expired.",
      fields: {},
    });
  });
});
