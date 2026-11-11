import { describe, expect, it } from "vite-plus/test";

import { parseInput } from "#/lib/validation";

import {
  aboutYouSchema,
  claimsSchema,
  errors,
  licenceSchema,
  namedDriversSchema,
  noClaimsOptions,
} from "./driver-steps";

// 5.3, call 13. Every schema takes today, so the boundaries are pinned to 11 Nov 2026.
const today = "2026-11-11";

function fields(schema: Parameters<typeof parseInput>[0], raw: unknown) {
  const result = parseInput(schema, raw);
  return result.ok ? {} : result.error.fields;
}

const about = {
  firstName: "Alex",
  lastName: "Morgan",
  dateOfBirth: "1991-05-12",
  status: "employed",
  occupation: "plumber",
  addressLine1: "18 Albion Road",
  town: "London",
};

describe("aboutYouSchema", () => {
  const schema = aboutYouSchema(today);

  it("accepts a driver who is 17 today and refuses one who is 17 tomorrow", () => {
    expect(parseInput(schema, { ...about, dateOfBirth: "2009-11-11" }).ok).toBe(true);
    expect(fields(schema, { ...about, dateOfBirth: "2009-11-12" })).toEqual({
      dateOfBirth: "You must be 17 or over to get a quote.",
    });
  });

  it("accepts 100 and treats anything older as a mistyped year", () => {
    expect(parseInput(schema, { ...about, dateOfBirth: "1926-11-11" }).ok).toBe(true);
    expect(fields(schema, { ...about, dateOfBirth: "1925-11-10" })).toEqual({
      dateOfBirth: "Check the year of birth.",
    });
  });

  it("asks for a missing or impossible date of birth", () => {
    expect(fields(schema, { ...about, dateOfBirth: "" }).dateOfBirth).toBe(
      "Enter a date of birth.",
    );
    expect(fields(schema, { ...about, dateOfBirth: undefined }).dateOfBirth).toBe(
      "Enter a date of birth.",
    );
  });

  it("asks for blank names and the address, and trims", () => {
    expect(
      fields(schema, { ...about, firstName: "  ", lastName: "", addressLine1: "", town: "" }),
    ).toEqual({
      firstName: "Enter your first name.",
      lastName: "Enter your last name.",
      addressLine1: "Enter the first line of your address.",
      town: "Enter your town or city.",
    });
    const parsed = parseInput(schema, { ...about, firstName: "  Alex " });
    expect(parsed.ok && parsed.data.firstName).toBe("Alex");
  });

  it("caps names at 50 characters and address lines at 100", () => {
    expect(fields(schema, { ...about, firstName: "a".repeat(51) }).firstName).toBeDefined();
    expect(parseInput(schema, { ...about, firstName: "a".repeat(50) }).ok).toBe(true);
    expect(fields(schema, { ...about, addressLine2: "a".repeat(101) }).addressLine2).toBeDefined();
  });

  it("drops an empty second address line", () => {
    const parsed = parseInput(schema, { ...about, addressLine2: "  " });
    expect(parsed.ok && parsed.data.addressLine2).toBeUndefined();
  });

  it("ties the occupation to the status", () => {
    expect(fields(schema, { ...about, status: "retired", occupation: "plumber" })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(fields(schema, { ...about, status: "employed", occupation: "student" })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(fields(schema, { ...about, status: "employed", occupation: "self_employed" })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(fields(schema, { ...about, status: "employed", occupation: undefined })).toEqual({
      occupation: "Choose your occupation.",
    });
    expect(parseInput(schema, { ...about, status: "retired", occupation: "retired" }).ok).toBe(
      true,
    );
    expect(
      parseInput(schema, { ...about, status: "self_employed", occupation: "self_employed" }).ok,
    ).toBe(true);
    expect(fields(schema, { ...about, status: undefined }).status).toBe(
      "Choose your employment status.",
    );
  });
});

const licence = {
  licenceType: "full_uk",
  licenceDate: "2010-07-18",
  noClaimsYears: 5,
  annualMileage: 8000,
  currentMileage: 18200,
  usage: "commuting",
  overnight: "driveway",
};

describe("licenceSchema", () => {
  const dob = "1991-05-12";
  const schema = licenceSchema(today, dob);

  it("accepts the frame's answers", () => {
    expect(parseInput(schema, licence).ok).toBe(true);
  });

  it("refuses a provisional licence", () => {
    expect(fields(schema, { ...licence, licenceType: "provisional" })).toEqual({
      licenceType: "Kerb can’t quote for a provisional licence yet.",
    });
  });

  it("refuses a licence before the 17th birthday or in the future", () => {
    expect(fields(schema, { ...licence, licenceDate: "2008-05-11", noClaimsYears: 0 })).toEqual({
      licenceDate: "The licence date can’t be before your 17th birthday.",
    });
    expect(parseInput(schema, { ...licence, licenceDate: "2008-05-12" }).ok).toBe(true);
    expect(fields(schema, { ...licence, licenceDate: "2026-11-12", noClaimsYears: 0 })).toEqual({
      licenceDate: "The licence date can’t be in the future.",
    });
    expect(fields(schema, { ...licence, licenceDate: "" }).licenceDate).toBe(
      "Enter the date your full licence was obtained.",
    );
  });

  it("keeps no-claims years within the years licensed", () => {
    const fiveYears = { ...licence, licenceDate: "2021-11-11" };
    expect(fields(schema, { ...fiveYears, noClaimsYears: 6 })).toEqual({
      noClaimsYears: "Your no-claims years can’t be more than the years you’ve held a licence.",
    });
    expect(parseInput(schema, { ...fiveYears, noClaimsYears: 5 }).ok).toBe(true);
    expect(fields(schema, { ...licence, noClaimsYears: undefined }).noClaimsYears).toBe(
      "Choose how many years of no-claims discount you have.",
    );
  });

  it("offers 0 to 9 or more years of no-claims", () => {
    expect(noClaimsOptions.map((o) => o.label)).toEqual([
      "0 years",
      "1 year",
      "2 years",
      "3 years",
      "4 years",
      "5 years",
      "6 years",
      "7 years",
      "8 years",
      "9 or more years",
    ]);
  });

  it("bounds the mileages and reads them typed with commas", () => {
    expect(fields(schema, { ...licence, annualMileage: 0 }).annualMileage).toBe(
      "Enter the annual mileage in whole miles.",
    );
    expect(fields(schema, { ...licence, annualMileage: 100_001 }).annualMileage).toBe(
      "Enter a mileage up to 100,000.",
    );
    expect(parseInput(schema, { ...licence, annualMileage: "100,000" }).ok).toBe(true);
    expect(parseInput(schema, { ...licence, currentMileage: 0 }).ok).toBe(true);
    expect(fields(schema, { ...licence, currentMileage: 1_000_000 }).currentMileage).toBe(
      "Enter a mileage up to 999,999.",
    );
    expect(fields(schema, { ...licence, currentMileage: "12.5" }).currentMileage).toBe(
      "Enter the current mileage in whole miles.",
    );
    expect(fields(schema, { ...licence, annualMileage: "" }).annualMileage).toBe(
      "Enter the annual mileage in whole miles.",
    );
  });

  it("asks for the use and the overnight location", () => {
    expect(fields(schema, { ...licence, usage: "racing", overnight: undefined })).toEqual({
      usage: "Choose how the car is used.",
      overnight: "Choose where the car is kept overnight.",
    });
  });
});

const incident = (date: string) => ({
  id: crypto.randomUUID(),
  date,
  type: "collision",
  fault: "not_at_fault",
  costPounds: 1200,
});

describe("claimsSchema", () => {
  const schema = claimsSchema(today);

  it("takes incidents in the last 5 years only", () => {
    expect(
      parseInput(schema, { any: true, incidents: [incident("2021-11-11")], confirmed: true }).ok,
    ).toBe(true);
    expect(
      fields(schema, { any: true, incidents: [incident("2021-11-10")], confirmed: true }),
    ).toEqual({ "incidents.0.date": "The incident must be in the last 5 years." });
    expect(
      fields(schema, { any: true, incidents: [incident("2026-11-12")], confirmed: true }),
    ).toEqual({ "incidents.0.date": "The incident date can’t be in the future." });
  });

  it("needs 1 to 10 incidents for yes, and none for no", () => {
    expect(fields(schema, { any: true, incidents: [], confirmed: true }).incidents).toBeDefined();
    const eleven = Array.from({ length: 11 }, () => incident("2024-01-01"));
    expect(
      fields(schema, { any: true, incidents: eleven, confirmed: true }).incidents,
    ).toBeDefined();
    expect(
      fields(schema, { any: false, incidents: [incident("2024-01-01")], confirmed: true })
        .incidents,
    ).toBeDefined();
    expect(parseInput(schema, { any: false, incidents: [], confirmed: true }).ok).toBe(true);
    expect(fields(schema, { incidents: [], confirmed: true }).any).toBe("Answer yes or no.");
  });

  it("bounds the cost and asks for the type and fault", () => {
    const bad = { ...incident("2024-01-01"), costPounds: 1_000_001, type: "", fault: undefined };
    expect(fields(schema, { any: true, incidents: [bad], confirmed: true })).toEqual({
      "incidents.0.costPounds": "Enter a cost up to £1,000,000.",
      "incidents.0.type": "Choose the type of incident.",
      "incidents.0.fault": "Choose who was at fault.",
    });
    const free = { ...incident("2024-01-01"), costPounds: 0 };
    expect(parseInput(schema, { any: true, incidents: [free], confirmed: true }).ok).toBe(true);
  });

  it("needs the confirmation", () => {
    expect(fields(schema, { any: false, incidents: [], confirmed: false })).toEqual({
      confirmed: "Confirm your driving history to continue.",
    });
  });
});

const named = {
  id: "d1",
  firstName: "Jamie",
  lastName: "Morgan",
  dateOfBirth: "1991-09-24",
  relationship: "spouse",
  status: "employed",
  occupation: "teacher",
  licenceType: "full_uk",
  licenceDate: "2010-07-18",
  anyClaims: false,
  pastClaims: 0,
};

describe("namedDriversSchema", () => {
  const schema = namedDriversSchema(today);

  it("accepts a driver, and no for none", () => {
    expect(parseInput(schema, { any: true, drivers: [named] }).ok).toBe(true);
    expect(parseInput(schema, { any: false, drivers: [] }).ok).toBe(true);
    expect(fields(schema, { drivers: [] }).any).toBe("Answer yes or no.");
  });

  it("allows at most 4 drivers", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...named, id: `d${i}` }));
    expect(fields(schema, { any: true, drivers: five }).drivers).toBeDefined();
  });

  it("refuses a 16-year-old, a provisional licence and more than 5 claims", () => {
    expect(
      fields(schema, {
        any: true,
        drivers: [
          {
            ...named,
            dateOfBirth: "2009-11-12",
            licenceType: "provisional",
            licenceDate: "2026-11-01",
          },
        ],
      }),
    ).toMatchObject({
      "drivers.0.dateOfBirth": "Named drivers must be 17 or over.",
      "drivers.0.licenceType": "A named driver needs a full licence.",
    });
    expect(
      fields(schema, { any: true, drivers: [{ ...named, anyClaims: true, pastClaims: 6 }] }),
    ).toEqual({ "drivers.0.pastClaims": "Choose how many." });
    expect(
      fields(schema, { any: true, drivers: [{ ...named, anyClaims: true, pastClaims: 0 }] }),
    ).toEqual({ "drivers.0.pastClaims": "Choose how many." });
    expect(
      parseInput(schema, { any: true, drivers: [{ ...named, anyClaims: true, pastClaims: 5 }] }).ok,
    ).toBe(true);
  });

  it("checks their licence date against their own birthday", () => {
    expect(
      fields(schema, { any: true, drivers: [{ ...named, licenceDate: "2008-09-23" }] }),
    ).toEqual({ "drivers.0.licenceDate": "The licence date can’t be before their 17th birthday." });
  });

  it("asks for their relationship", () => {
    expect(fields(schema, { any: true, drivers: [{ ...named, relationship: "" }] })).toEqual({
      "drivers.0.relationship": "Choose their relationship to you.",
    });
  });
});

describe("error messages", () => {
  it("never repeat what was typed", () => {
    const typed = "Zq9xValue";
    const raws: [Parameters<typeof parseInput>[0], unknown][] = [
      [
        aboutYouSchema(today),
        Object.fromEntries(Object.keys(about).map((k) => [k, typed.repeat(9)])),
      ],
      [
        licenceSchema(today, about.dateOfBirth),
        Object.fromEntries(Object.keys(licence).map((k) => [k, typed])),
      ],
      [
        claimsSchema(today),
        {
          any: typed,
          incidents: [{ date: typed, type: typed, fault: typed, costPounds: typed }],
          confirmed: typed,
        },
      ],
      [
        namedDriversSchema(today),
        {
          any: true,
          drivers: [Object.fromEntries(Object.keys(named).map((k) => [k, typed.repeat(9)]))],
        },
      ],
    ];
    for (const [schema, raw] of raws) {
      const messages = Object.values(fields(schema, raw));
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) expect(message).not.toContain(typed);
    }
    expect(Object.values(errors).every((m) => !m.includes(typed))).toBe(true);
  });
});
