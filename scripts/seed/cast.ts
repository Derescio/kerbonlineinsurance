import type { CatalogueRecord } from "#/server/data/reference";

import { addDays, type SeedBuilder, type StaffHandle } from "./builders.ts";
import { castEmail } from "./guard.ts";
import { REVIEW_TEXTS } from "./names.ts";
import type { Rng } from "./random.ts";

// The named people you can sign in as (4.9, "The cast"). Every choice is fixed, so each story is
// the same on every seed. Their purchases are recent (Jul–Oct 2026), so policies are live in 2027.

const at = (iso: string) => new Date(iso);

function variant(b: SeedBuilder, make: string, model: string, year: number): CatalogueRecord {
  const rows = b.ctx.catalogue.filter((r) => r.make === make && r.model === model);
  const row = rows.find((r) => r.year === year) ?? rows[0];
  if (!row) throw new Error(`The catalogue has no ${make} ${model}`);
  return row;
}

export interface Staff {
  handler: StaffHandle;
  admin: StaffHandle;
}

export function buildStaff(b: SeedBuilder, rng: Rng): Staff {
  const since = at("2025-11-01T09:00:00Z");
  const handler = b.user(rng.fork("handler"), {
    email: castEmail(b.ctx.inbox, "handler"),
    name: "Sam Carter",
    createdAt: since,
    cast: "handler",
    staff: { displayName: "Sam from Kerb claims", roles: ["claims_handler"] },
  });
  const admin = b.user(rng.fork("admin"), {
    email: castEmail(b.ctx.inbox, "admin"),
    name: "Jordan Ellis",
    createdAt: since,
    cast: "admin",
    staff: { displayName: "Jordan from Kerb", roles: ["admin"] },
  });
  return {
    handler: { id: handler.id, role: "claims_handler" },
    admin: { id: admin.id, role: "admin" },
  };
}

function castCustomer(
  b: SeedBuilder,
  rng: Rng,
  role: "customer-a" | "customer-b" | "business" | "closure-settled" | "closure-held",
  person: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    postcode: string;
    addressLine1: string;
  },
  signedUp: Date,
) {
  const user = b.user(rng, {
    email: castEmail(b.ctx.inbox, role),
    name: `${person.firstName} ${person.lastName}`,
    createdAt: signedUp,
    cast: role,
  });
  return b.customer(rng, { user, ...person });
}

export function buildCast(b: SeedBuilder, root: Rng, staff: Staff) {
  // Customer A: car and home bundle, a settled claim, a published review
  {
    const rng = root.fork("customer-a");
    const amelia = castCustomer(
      b,
      rng,
      "customer-a",
      {
        firstName: "Amelia",
        lastName: "Hart",
        dateOfBirth: "1981-05-14",
        postcode: "LS6 2AB",
        addressLine1: "14 Larch Grove",
      },
      at("2026-08-03T10:12:00Z"),
    );
    const quote = b.quote(rng, amelia, at("2026-08-03T10:20:00Z"), [
      {
        product: "car",
        variant: variant(b, "Ford", "Focus", 2019),
        driver: {
          firstName: "Amelia",
          lastName: "Hart",
          dateOfBirth: "1981-05-14",
          occupation: "teacher",
          licenceYears: 25,
          noClaimsYears: 12,
          pastClaims: 0,
        },
        registration: "YK19 HRT",
        annualMileage: 8_000,
        usage: "commuting",
        overnightLocation: "driveway",
        voluntaryExcessPence: 25_000,
        coverLevel: "comprehensive",
        addons: ["breakdown_uk"],
      },
      {
        product: "home",
        addressLine1: "14 Larch Grove",
        propertyType: "semi",
        yearBuilt: 1965,
        bedrooms: 3,
        rebuildCostPence: 24_000_000,
        contentsValuePence: 4_500_000,
        hasAlarm: false,
        hasSmokeAlarm: true,
        lockType: "multipoint",
        pastClaims: 0,
        coverLevel: "comprehensive",
        addons: ["home_emergency"],
      },
    ]);
    const [car] = b.accept(rng, quote, at("2026-08-04T19:05:00Z"), "annual");
    b.claim(rng, car!, "settled", at("2026-09-10T08:30:00Z"), staff.handler, {
      incidentType: "collision",
      claimedAmountPence: 184_000,
      description: "I was stationary at lights when the car behind ran into me.",
    });
    b.review(rng, car!, at("2026-10-05T18:40:00Z"), REVIEW_TEXTS[1]!, "published");
  }

  // Customer B: one car policy, a claim being assessed by the handler
  {
    const rng = root.fork("customer-b");
    const ben = castCustomer(
      b,
      rng,
      "customer-b",
      {
        firstName: "Ben",
        lastName: "Okafor",
        dateOfBirth: "1994-02-20",
        postcode: "M14 5RT",
        addressLine1: "7 Granby Terrace",
      },
      at("2026-09-02T12:00:00Z"),
    );
    const quote = b.quote(rng, ben, at("2026-09-02T12:06:00Z"), [
      {
        product: "car",
        variant: variant(b, "Vauxhall", "Corsa", 2020),
        driver: {
          firstName: "Ben",
          lastName: "Okafor",
          dateOfBirth: "1994-02-20",
          occupation: "chef",
          licenceYears: 9,
          noClaimsYears: 6,
          pastClaims: 0,
        },
        registration: "MA20 OKF",
        annualMileage: 9_000,
        usage: "commuting",
        overnightLocation: "street",
        voluntaryExcessPence: 10_000,
        coverLevel: "comprehensive",
        addons: [],
      },
    ]);
    const [car] = b.accept(rng, quote, at("2026-09-03T08:15:00Z"), "monthly");
    b.claim(rng, car!, "assessing", at("2026-10-20T17:45:00Z"), staff.handler, {
      incidentType: "collision",
      claimedAmountPence: 92_000,
      description: "Reversed into a bollard in a car park; rear bumper damaged.",
    });
  }

  // Business owner: a florist's policy, then a bigger quote referred and waiting for a person
  {
    const rng = root.fork("business");
    const priya = castCustomer(
      b,
      rng,
      "business",
      {
        firstName: "Priya",
        lastName: "Shah",
        dateOfBirth: "1979-11-02",
        postcode: "BS1 4QA",
        addressLine1: "Shah Florists, 3 Wharf Street",
      },
      at("2026-07-01T09:30:00Z"),
    );
    const quote = b.quote(rng, priya, at("2026-07-01T09:41:00Z"), [
      {
        product: "business",
        tradeClass: "florist",
        turnoverPence: 18_000_000,
        employees: 2,
        coverLevel: "essential",
        addons: ["contents_stock"],
      },
    ]);
    b.accept(rng, quote, at("2026-07-02T10:00:00Z"), "annual");
    // Expanding into wholesale: over £5m turnover is referred (rating v1, high_turnover)
    b.quote(rng, priya, at("2026-10-22T14:10:00Z"), [
      {
        product: "business",
        tradeClass: "florist",
        turnoverPence: 600_000_000,
        employees: 12,
        coverLevel: "plus",
        addons: ["contents_stock", "business_interruption"],
      },
    ]);
  }

  // Closure check, settled: only a settled claim, so 4.7's run closes this account
  {
    const rng = root.fork("closure-settled");
    const tom = castCustomer(
      b,
      rng,
      "closure-settled",
      {
        firstName: "Tom",
        lastName: "Reed",
        dateOfBirth: "1958-07-30",
        postcode: "EX4 3PL",
        addressLine1: "22 Belmont Road",
      },
      at("2026-08-10T15:00:00Z"),
    );
    const quote = b.quote(rng, tom, at("2026-08-10T15:04:00Z"), [
      {
        product: "car",
        variant: variant(b, "Toyota", "Yaris", 2016),
        driver: {
          firstName: "Tom",
          lastName: "Reed",
          dateOfBirth: "1958-07-30",
          occupation: "retired",
          licenceYears: 45,
          noClaimsYears: 15,
          pastClaims: 0,
        },
        registration: "WR16 TRD",
        annualMileage: 4_000,
        usage: "social",
        overnightLocation: "garage",
        voluntaryExcessPence: 25_000,
        coverLevel: "comprehensive",
        addons: [],
      },
    ]);
    const [car] = b.accept(rng, quote, at("2026-08-11T09:00:00Z"), "annual");
    b.claim(rng, car!, "settled", addDays(at("2026-09-01T11:00:00Z"), 0), staff.handler, {
      incidentType: "glass",
      claimedAmountPence: 32_000,
    });
  }

  // Closure check, held: an open claim, so 4.7's run holds this account
  {
    const rng = root.fork("closure-held");
    const grace = castCustomer(
      b,
      rng,
      "closure-held",
      {
        firstName: "Grace",
        lastName: "Lin",
        dateOfBirth: "1990-03-08",
        postcode: "NG7 2RD",
        addressLine1: "Flat 4, 61 Clarendon Way",
      },
      at("2026-08-20T20:00:00Z"),
    );
    const quote = b.quote(rng, grace, at("2026-08-20T20:09:00Z"), [
      {
        product: "home",
        addressLine1: "Flat 4, 61 Clarendon Way",
        propertyType: "flat",
        yearBuilt: 1990,
        bedrooms: 2,
        rebuildCostPence: 15_000_000,
        contentsValuePence: 3_000_000,
        hasAlarm: true,
        hasSmokeAlarm: true,
        lockType: "multipoint",
        pastClaims: 0,
        coverLevel: "comprehensive",
        addons: [],
      },
    ]);
    const [home] = b.accept(rng, quote, at("2026-08-21T07:30:00Z"), "monthly");
    b.claim(rng, home!, "received", at("2026-10-28T09:10:00Z"), staff.handler, {
      incidentType: "other",
      claimedAmountPence: 210_000,
      description: "Water leak from the bathroom upstairs damaged the kitchen ceiling.",
    });
  }
}
