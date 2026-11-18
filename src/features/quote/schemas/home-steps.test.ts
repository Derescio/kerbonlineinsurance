import { describe, expect, it } from "vite-plus/test";

import { parseInput } from "#/lib/validation";

import { errors } from "./driver-steps";
import {
  contentsSchema,
  homeAboutSchema,
  homeClaimsSchema,
  homeErrors,
  propertySchema,
} from "./home-steps";

// 5.7, decisions 3–6. Every schema that moves with the date takes today, so the boundaries are
// pinned to 16 Nov 2026.
const today = "2026-11-16";

function fields(schema: Parameters<typeof parseInput>[0], raw: unknown) {
  const result = parseInput(schema, raw);
  return result.ok ? {} : result.error.fields;
}

function parsed<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  raw: unknown,
) {
  const result = schema.safeParse(raw);
  expect(result.success).toBe(true);
  return result.data as T;
}

const about = {
  firstName: "Priya",
  lastName: "Shah",
  dateOfBirth: "1988-03-02",
  status: "employed",
  occupation: "teacher",
};

const property = {
  address: { line1: "18 Albion Road", town: "London", picked: true },
  propertyType: "terraced",
  yearBuilt: "1985",
  bedrooms: "3",
  rebuildCostPounds: "250,000",
};

const contents = {
  contentsValuePounds: "50,000",
  valuablesPounds: "5,000",
  lockType: "five_lever",
  windowLocks: "all_accessible",
  alarm: "installed_unmonitored",
  smokeAlarm: true,
};

const claim = {
  id: "c1",
  date: "2024-03-12",
  type: "escape_of_water",
  amountPounds: "950",
  status: "settled",
};

describe("homeAboutSchema", () => {
  it("needs a home buyer to be 18, not car's 17", () => {
    expect(fields(homeAboutSchema(today), { ...about, dateOfBirth: "2009-11-17" })).toEqual({
      dateOfBirth: homeErrors.under18,
    });
    expect(homeErrors.under18).toBe("You must be 18 or over to get a home quote.");
    expect(fields(homeAboutSchema(today), { ...about, dateOfBirth: "2008-11-16" })).toEqual({});
  });

  it("asks employment status and occupation as car's About you does (5.7c, decision 3)", () => {
    const schema = homeAboutSchema(today);
    expect(fields(schema, { ...about, status: "" })).toMatchObject({
      status: "Choose your employment status.",
    });
    expect(fields(schema, { ...about, occupation: "" })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(fields(schema, { ...about, status: "retired", occupation: "retired" })).toEqual({});
    expect(fields(schema, { ...about, status: "retired", occupation: "teacher" })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(fields(schema, { ...about, occupation: "retired" })).toEqual({
      occupation: "Choose your occupation.",
    });
  });

  it("uses car's name messages", () => {
    expect(fields(homeAboutSchema(today), { ...about, firstName: " " })).toEqual({
      firstName: errors.firstName,
    });
  });
});

describe("propertySchema", () => {
  const schema = propertySchema(2026);

  it("takes a rebuild cost from £50,000 to £5,000,000", () => {
    for (const ok of ["50000", "5000000"]) {
      expect(fields(schema, { ...property, rebuildCostPounds: ok })).toEqual({});
    }
    for (const bad of ["49999", "5000001"]) {
      expect(fields(schema, { ...property, rebuildCostPounds: bad })).toEqual({
        rebuildCostPounds: "Enter a rebuild cost between £50,000 and £5,000,000.",
      });
    }
  });

  it("takes a year built from 1500 to this year", () => {
    for (const ok of ["1500", "2026"]) {
      expect(fields(schema, { ...property, yearBuilt: ok })).toEqual({});
    }
    for (const bad of ["1499", "2027"]) {
      expect(fields(schema, { ...property, yearBuilt: bad })).toEqual({
        yearBuilt: "Enter a year between 1500 and 2026.",
      });
    }
  });

  it("takes 0 (a studio) to 10 bedrooms", () => {
    expect(fields(schema, { ...property, bedrooms: "0" })).toEqual({});
    expect(fields(schema, { ...property, bedrooms: "10" })).toEqual({});
    expect(fields(schema, { ...property, bedrooms: "11" })).toEqual({
      bedrooms: "Choose the number of bedrooms.",
    });
  });

  it("needs an address, picked or entered", () => {
    const { address: _a, ...rest } = property;
    expect(fields(schema, rest)).toEqual({
      address: "Choose your address, or enter it manually.",
    });
    expect(
      fields(schema, { ...property, address: { line1: "", town: "London", picked: false } }),
    ).toEqual({ "address.line1": errors.addressLine1 });
  });

  it("parses amounts typed with commas into numbers", () => {
    const value = parsed<{ rebuildCostPounds: number; yearBuilt: number; bedrooms: number }>(
      schema,
      property,
    );
    expect(value.rebuildCostPounds).toBe(250_000);
    expect(value.yearBuilt).toBe(1985);
    expect(value.bedrooms).toBe(3);
  });

  it("names the property type when it's missing", () => {
    expect(fields(schema, { ...property, propertyType: "" })).toEqual({
      propertyType: "Choose the property type.",
    });
  });
});

describe("contentsSchema", () => {
  it("takes contents from £5,000 to £500,000", () => {
    expect(fields(contentsSchema, { ...contents, contentsValuePounds: "5000" })).toEqual({});
    expect(fields(contentsSchema, { ...contents, contentsValuePounds: "500000" })).toEqual({});
    expect(
      fields(contentsSchema, { ...contents, contentsValuePounds: "4999", valuablesPounds: "0" }),
    ).toEqual({
      contentsValuePounds: "Enter a contents value between £5,000 and £500,000.",
    });
  });

  it("keeps valuables within the contents total", () => {
    expect(
      fields(contentsSchema, {
        ...contents,
        contentsValuePounds: "5000",
        valuablesPounds: "5001",
      }),
    ).toEqual({
      valuablesPounds:
        "Valuables are part of your contents, so they can’t be more than the contents total.",
    });
  });

  it("names each security answer that's missing", () => {
    expect(
      fields(contentsSchema, { ...contents, lockType: "", windowLocks: "", alarm: "" }),
    ).toEqual({
      lockType: "Choose the main door lock.",
      windowLocks: "Choose the window locks.",
      alarm: "Choose the burglar alarm.",
    });
  });
});

describe("homeClaimsSchema", () => {
  const schema = homeClaimsSchema(today);
  const answers = { any: true, claims: [claim], confirmed: true };

  it("takes a claim in the last 5 years", () => {
    const value = parsed<{ claims: { amountPounds: number }[] }>(schema, answers);
    expect(value.claims[0]!.amountPounds).toBe(950);
  });

  it("needs a claim on Yes, and none on No", () => {
    expect(fields(schema, { ...answers, claims: [] })).toEqual({
      claims: "Add the claim, or answer no.",
    });
    expect(fields(schema, { ...answers, any: false })).toEqual({
      claims: "Remove the claims, or answer yes.",
    });
  });

  it("takes up to 5 claims", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...claim, id: `c${i}` }));
    expect(fields(schema, { ...answers, claims: six })).toEqual({
      claims: "You can add up to 5 claims.",
    });
  });

  it("keeps each claim inside the 5-year window", () => {
    expect(fields(schema, { ...answers, claims: [{ ...claim, date: "2021-11-15" }] })).toEqual({
      "claims.0.date": errors.incidentOld,
    });
    expect(fields(schema, { ...answers, claims: [{ ...claim, date: "2026-11-17" }] })).toEqual({
      "claims.0.date": errors.incidentFuture,
    });
  });

  it("takes amounts from £0 to £1,000,000", () => {
    expect(fields(schema, { ...answers, claims: [{ ...claim, amountPounds: "0" }] })).toEqual({});
    expect(
      fields(schema, { ...answers, claims: [{ ...claim, amountPounds: "1,000,000" }] }),
    ).toEqual({});
  });

  it("names a missing type and status", () => {
    expect(fields(schema, { ...answers, claims: [{ ...claim, type: "", status: "" }] })).toEqual({
      "claims.0.type": "Choose the type of claim.",
      "claims.0.status": "Choose the claim status.",
    });
  });

  it("needs the details confirmed", () => {
    expect(fields(schema, { ...answers, confirmed: false })).toEqual({
      confirmed: "Confirm your details to continue.",
    });
  });
});
