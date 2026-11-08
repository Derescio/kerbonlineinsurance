import type { CatalogueRecord } from "#/server/data/reference";
import type { CoverLevel } from "#/server/db/schema/values";
import { UK_POSTCODE_AREAS } from "#/server/reference/postcode-areas";

import {
  addDays,
  ageAt,
  type DriverSpec,
  type ItemSpec,
  makePostcode,
  type QuoteHandle,
  registration,
  type SeedBuilder,
} from "./builders.ts";
import type { Staff } from "./cast.ts";
import { AREA_WEIGHTS, FIRST_NAMES, LAST_NAMES, REVIEW_TEXTS, STREET_NAMES } from "./names.ts";
import { type Rng, SEED_TO } from "./random.ts";

// The synthetic crowd (4.9, call 17): customers signing up across the year, quoting, buying some,
// claiming on a few. Each customer reads its own stream (`crowd:<i>`), so a bigger crowd never
// changes the first customers. The shares below are tuned so 2,000 customers give about 6,000
// quotes, 1,500 policies and 300 claims.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONTH_WEIGHTS = [1, 1, 1.5, 1, 1, 1, 1, 1, 1, 1, 1.5, 1]; // Nov 2025 … Oct 2026; Jan and Sep busier
const AGE_BANDS: readonly (readonly [[number, number], number])[] = [
  [[18, 24], 8],
  [[25, 34], 18],
  [[35, 44], 20],
  [[45, 54], 20],
  [[55, 64], 17],
  [[65, 74], 12],
  [[75, 85], 5],
];
const COVER: readonly (readonly [CoverLevel, number])[] = [
  ["essential", 15],
  ["comprehensive", 70],
  ["plus", 15],
];

const lower = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function buildCrowd(b: SeedBuilder, root: Rng, staff: Staff) {
  const areas = UK_POSTCODE_AREAS.map((a) => [a, AREA_WEIGHTS[a] ?? 1] as const);
  // Lower groups are the common cars on UK roads
  const cars = b.ctx.catalogue.map((row) => [row, 1 / row.insuranceGroup] as const);
  // Performance and prestige cars, so referrals and declines show up (4.8 decision 3)
  const fastCars = b.ctx.catalogue.filter((row) => row.insuranceGroup >= 40);
  const occupations = b.ctx.versions.car.source.lookups
    .filter((l) => l.lookup === "occupation")
    .map((l) => l.key);
  const trades = b.ctx.versions.business.source.lookups
    .filter((l) => l.lookup === "trade")
    .map((l) => l.key);
  const businessAddons = b.ctx.versions.business.source.addons.map((a) => a.addon);
  const lists = { areas, cars, fastCars, occupations, trades, businessAddons };

  for (let i = 0; i < b.ctx.crowdSize; i++) {
    crowdCustomer(b, root.fork(`crowd:${i}`), i, staff, lists);
  }
}

interface Lists {
  areas: readonly (readonly [string, number])[];
  cars: readonly (readonly [CatalogueRecord, number])[];
  fastCars: readonly CatalogueRecord[];
  occupations: readonly string[];
  trades: readonly string[];
  businessAddons: readonly string[];
}

function crowdCustomer(b: SeedBuilder, rng: Rng, i: number, staff: Staff, lists: Lists) {
  // A few fixed indexes keep a closure or two in any crowd of 20 or more, stable as it grows
  const closes = i % 200 === 13 ? "closed" : i % 100 === 7 ? "cancelled" : null;

  const month =
    closes === "closed"
      ? rng.int(0, 5)
      : rng.weighted(MONTH_WEIGHTS.map((w, m) => [m, w] as const));
  const monthStart = new Date(Date.UTC(2025, 10 + month, 1));
  const signedUp = new Date(
    Math.min(
      SEED_TO.getTime() - 2 * DAY,
      monthStart.getTime() + rng.int(0, 27) * DAY + rng.int(7, 22) * HOUR,
    ),
  );

  const firstName = rng.pick(FIRST_NAMES);
  const lastName = rng.pick(LAST_NAMES);
  const [from, to] = rng.weighted(AGE_BANDS);
  const dateOfBirth = isoDate(
    addDays(SEED_TO, -Math.round((rng.int(from, to) + rng.next()) * 365.25)),
  );
  const user = b.user(rng, {
    email: `${lower(firstName)}.${lower(lastName)}.${i}@kerb-synthetic.invalid`,
    name: `${firstName} ${lastName}`,
    createdAt: signedUp,
    cast: null,
  });
  const customer = b.customer(rng, {
    user,
    firstName,
    lastName,
    dateOfBirth,
    postcode: makePostcode(rng, rng.weighted(lists.areas)),
    addressLine1: `${rng.int(1, 140)} ${rng.pick(STREET_NAMES)}`,
  });
  const person: DriverSpec = driverFor(rng, firstName, lastName, dateOfBirth, signedUp, lists);

  if (closes === "closed") {
    // One bought car policy, no claims, then a closure that has run (4.7)
    const quote = b.quote(rng, customer, addDays(signedUp, 0.01), [carSpec(rng, person, lists)]);
    if (quote.items.every((x) => x.row.outcome === "quoted")) {
      b.accept(rng, quote, new Date(quote.at.getTime() + 2 * HOUR), "annual");
    }
    b.closure(rng, customer, addDays(signedUp, rng.int(40, 90)), "closed");
    return;
  }

  const count = rng.weighted([
    [1, 20],
    [2, 25],
    [3, 25],
    [4, 18],
    [5, 12],
  ] as const);
  const times = Array.from({ length: count }, (_, n) =>
    n === 0 ? addDays(signedUp, 0.005) : rng.dateBetween(signedUp, SEED_TO),
  ).sort((x, y) => x.getTime() - y.getTime());

  for (const at of times) {
    if (rng.chance(0.12)) {
      b.quote(rng, customer, at, null);
      continue;
    }
    const quote = b.quote(rng, customer, at, specsFor(rng, person, lists));
    journey(b, rng, quote, staff);
  }

  if (closes === "cancelled") {
    const requested = rng.dateBetween(addDays(signedUp, 1), addDays(SEED_TO, -25));
    if (requested > signedUp) b.closure(rng, customer, requested, "cancelled");
  }
}

/** After pricing: a referral decided (or not), bought (or left to expire), then claims and a review */
function journey(b: SeedBuilder, rng: Rng, quote: QuoteHandle, staff: Staff) {
  const pricedAt = new Date(quote.at.getTime() + 15 * 60_000);
  const referred = quote.items.some((x) => x.row.outcome === "referred");
  if (referred) {
    const decideAt = new Date(pricedAt.getTime() + rng.int(4, 72) * HOUR);
    const recent = SEED_TO.getTime() - pricedAt.getTime() < 30 * DAY;
    if (decideAt > SEED_TO || (recent && rng.chance(0.5))) return; // still waiting for a person
    // The admin decided the older referrals; the handler the recent ones
    const decider = recent ? staff.handler : staff.admin;
    b.decideReferrals(rng, quote, decider, decideAt, rng.chance(0.7) ? "quoted" : "declined");
  }
  if (quote.items.length === 0 || quote.items.some((x) => x.row.outcome !== "quoted")) return;

  const buyChance = quote.items.length >= 2 ? 0.4 : 0.25;
  const acceptAt = new Date(
    Math.max(pricedAt.getTime(), quote.row.updatedAt!.getTime()) + rng.int(1, 72) * HOUR,
  );
  if (!rng.chance(buyChance) || acceptAt > SEED_TO) {
    if (quote.row.validUntil! < SEED_TO) {
      Object.assign(quote.row, { status: "expired", updatedAt: quote.row.validUntil });
    }
    return;
  }

  const policies = b.accept(rng, quote, acceptAt, rng.chance(0.45) ? "monthly" : "annual");
  for (const policy of policies) {
    const start = policy.startsOn;
    if (rng.chance(0.04) && start < SEED_TO) {
      b.cancelPolicy(policy, rng.dateBetween(start, SEED_TO));
      continue;
    }
    if (rng.chance(0.2) && start < addDays(SEED_TO, -1)) {
      const at = rng.dateBetween(start, SEED_TO);
      b.claim(rng, policy, claimStatusFor(rng, at), at, staff.handler);
    }
    const reviewAt = addDays(start, rng.int(20, 90));
    if (rng.chance(0.25) && reviewAt < SEED_TO) {
      const text = rng.weighted(REVIEW_TEXTS.map((t) => [t, t.rating] as const));
      const status = rng.weighted([
        ["published", 85],
        ["pending", 10],
        ["rejected", 5],
      ] as const);
      b.review(rng, policy, reviewAt, text, status);
    }
  }
}

/** Older claims have had time to finish; the timeline (2, +7, +8 days) must end before SEED_TO */
function claimStatusFor(rng: Rng, at: Date) {
  if (rng.chance(0.06)) return "draft" as const;
  const days = (SEED_TO.getTime() - at.getTime()) / DAY;
  if (days < 2) return "received" as const;
  if (days < 9) return rng.chance(0.7) ? ("assessing" as const) : ("received" as const);
  if (days < 17)
    return rng.weighted([
      ["approved", 5],
      ["declined", 2],
      ["assessing", 3],
    ] as const);
  return rng.weighted([
    ["settled", 75],
    ["declined", 15],
    ["approved", 5],
    ["assessing", 5],
  ] as const);
}

function driverFor(
  rng: Rng,
  firstName: string,
  lastName: string,
  dateOfBirth: string,
  at: Date,
  lists: Lists,
): DriverSpec {
  const age = ageAt(dateOfBirth, at);
  const occupation =
    age >= 67 && rng.chance(0.8)
      ? "retired"
      : age <= 22 && rng.chance(0.6)
        ? "student"
        : rng.pick(lists.occupations);
  const licenceYears = rng.int(Math.min(1, age - 17), Math.max(0, age - 17));
  return {
    firstName,
    lastName,
    dateOfBirth,
    occupation,
    licenceYears,
    noClaimsYears: Math.max(0, licenceYears - rng.int(0, 3)),
    pastClaims: rng.weighted([
      [0, 82],
      [1, 10],
      [2, 4],
      [3, 4],
    ] as const),
  };
}

function specsFor(rng: Rng, person: DriverSpec, lists: Lists): ItemSpec[] {
  if (rng.chance(0.12)) return [carSpec(rng, person, lists), homeSpec(rng)];
  const product = rng.weighted([
    ["car", 60],
    ["home", 30],
    ["business", 10],
  ] as const);
  if (product === "car") return [carSpec(rng, person, lists)];
  if (product === "home") return [homeSpec(rng)];
  return [businessSpec(rng, lists)];
}

function carSpec(rng: Rng, person: DriverSpec, lists: Lists): ItemSpec {
  const variant = rng.chance(0.1) ? rng.pick(lists.fastCars) : rng.weighted(lists.cars);
  const named = rng.chance(0.15)
    ? {
        ...person,
        firstName: rng.pick(FIRST_NAMES),
        dateOfBirth: isoDate(addDays(SEED_TO, -Math.round(rng.int(18, 75) * 365.25))),
        licenceYears: rng.int(0, 10),
        noClaimsYears: 0,
        pastClaims: 0,
      }
    : undefined;
  return {
    product: "car",
    variant,
    driver: person,
    namedDriver: named,
    registration: registration(rng, variant.year),
    annualMileage: rng.weighted([
      [4_000, 20],
      [7_000, 30],
      [10_000, 25],
      [14_000, 15],
      [20_000, 7],
      [32_000, 3],
    ] as const),
    usage: rng.weighted([
      ["social", 30],
      ["commuting", 60],
      ["business", 10],
    ] as const),
    overnightLocation: rng.weighted([
      ["garage", 15],
      ["driveway", 55],
      ["street", 30],
    ] as const),
    voluntaryExcessPence: rng.pick([0, 10_000, 25_000, 25_000, 50_000]),
    coverLevel: rng.weighted(COVER),
    addons: [
      ...(rng.chance(0.35) ? ["breakdown_uk"] : []),
      ...(rng.chance(0.3) ? ["motor_legal"] : []),
    ],
  };
}

function homeSpec(rng: Rng): ItemSpec {
  const bedrooms = rng.weighted([
    [1, 10],
    [2, 25],
    [3, 40],
    [4, 18],
    [5, 7],
  ] as const);
  return {
    product: "home",
    addressLine1: `${rng.int(1, 140)} ${rng.pick(STREET_NAMES)}`,
    propertyType: rng.weighted([
      ["detached", 20],
      ["semi", 30],
      ["terraced", 25],
      ["flat", 18],
      ["bungalow", 7],
    ] as const),
    yearBuilt: rng.chance(0.02) ? rng.int(1650, 1749) : rng.int(1860, 2024),
    bedrooms,
    // £120k–£600k rebuild, a rare £1.1m+ one that's referred
    rebuildCostPence: rng.chance(0.04)
      ? rng.int(110_000_000, 140_000_000)
      : rng.int(120, 600) * 100_000,
    contentsValuePence: rng.chance(0.03)
      ? rng.int(16_000_000, 20_000_000)
      : rng.int(15, 80) * 100_000,
    hasAlarm: rng.chance(0.4),
    hasSmokeAlarm: rng.chance(0.92),
    lockType: rng.weighted([
      ["standard", 25],
      ["five_lever", 35],
      ["multipoint", 40],
    ] as const),
    pastClaims: rng.weighted([
      [0, 88],
      [1, 8],
      [2, 3],
      [3, 1],
    ] as const),
    coverLevel: rng.weighted(COVER),
    addons: [
      ...(rng.chance(0.3) ? ["home_emergency"] : []),
      ...(rng.chance(0.2) ? ["legal_expenses"] : []),
      ...(rng.chance(0.15) ? ["personal_possessions"] : []),
    ],
  };
}

function businessSpec(rng: Rng, lists: Lists): ItemSpec {
  return {
    product: "business",
    tradeClass: rng.pick(lists.trades),
    turnoverPence: rng.weighted([
      [rng.int(10, 50) * 100_000, 30],
      [rng.int(51, 100) * 100_000, 25],
      [rng.int(101, 250) * 100_000, 20],
      [rng.int(251, 1_000) * 100_000, 18],
      [rng.int(1_001, 4_000) * 100_000, 6],
      [rng.int(5_100, 8_000) * 100_000, 5],
    ] as const),
    employees: rng.weighted([
      [0, 45],
      [rng.int(1, 3), 30],
      [rng.int(4, 10), 18],
      [rng.int(11, 30), 6],
      [rng.int(51, 80), 4],
    ] as const),
    coverLevel: rng.weighted(COVER),
    addons: lists.businessAddons.filter(() => rng.chance(0.3)),
  };
}
