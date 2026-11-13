import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { instalmentDates } from "#/features/quote/policy-terms";
import { monthlyPayment } from "#/features/rating/money";
import { priceQuote, type QuoteItemRequest } from "#/features/rating/price-quote";
import { Tables } from "#/features/rating/tables";
import { carInputs, homeInputs } from "#/features/rating/test-tables";
import { audit } from "#/server/audit/audit";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import type { CarDetails, HomeDetails } from "#/server/data/quote-rows";
import {
  clearReferenceCaches,
  getActiveRatingTables,
  getCatalogue,
  upsertReferenceData,
} from "#/server/data/reference";
import { saveQuote } from "#/server/data/save-quote";
import { closeDb, getDb } from "#/server/db/client";
import {
  accountClosures,
  auditLog,
  bundles,
  idempotencyKeys,
  jobs,
  payments,
  policies,
  quoteItemAddons,
  quoteItemOptions,
  quoteItems,
  quotes,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { renderEmail } from "#/server/email/registry";
import type { JobDeps } from "#/server/jobs/types";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer, makeStaff, makeUser } from "#/test/factories";

import { payForQuote } from "./pay";
import { saveCarQuoteFor } from "./save";

// The real audit(), with a spy so one test can make it throw after the policy insert
vi.mock("#/server/audit/audit", async (original) => {
  const real = await original<typeof import("#/server/audit/audit")>();
  return { ...real, audit: vi.fn(real.audit) };
});

// Paying for a saved quote (5.6, decision 7): one transaction writes the policies, the payments,
// a bundle for two items, the accepted quote, the audit rows and the email job. A double click or
// a retry makes one policy, and a failure part-way leaves nothing.

// The journey fixture's dates hold on 11 Nov 2026; cover may start up to 30 days on
const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const CARD = { name: "Alex Morgan", number: "4242 4242 4242 4242", expiry: "12 / 30", code: "123" };
const ctx = { headers: new Headers() };
// Leaves the email job queued, so the test can read it
const deps: JobDeps & { now: Date } = {
  sendEmail: vi.fn(),
  defer: () => undefined,
  holdEmails: true,
  now: NOW,
};

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

/** A user with a priced car quote (Task 2's save), and their actor */
async function pricedCarQuote(
  journey?: Journey,
): Promise<{ actor: Actor; quoteId: string; reference: string; email: string }> {
  const user = await makeUser();
  const answers = journey ?? (await golf());
  const saved = await withTx(getDb(), (tx) =>
    saveCarQuoteFor(tx, user.id, { journey: answers, now: NOW }),
  );
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  return { actor, quoteId: saved.quoteId, reference: saved.reference, email: user.email };
}

const input = (quoteId: string, overrides: Record<string, unknown> = {}) => ({
  quoteId,
  plan: "annual",
  startsOn: STARTS_ON,
  card: CARD,
  detailsConfirmed: true,
  coverAcknowledged: true,
  ...overrides,
});

const pay = (
  actor: Actor,
  quoteId: string,
  overrides: Record<string, unknown> = {},
  key?: string,
) =>
  payForQuote(
    actor,
    { input: input(quoteId, overrides), idempotencyKey: key ?? randomUUID() },
    ctx,
    deps,
  );

async function rowCounts() {
  const db = getDb();
  return {
    policies: (await db.select().from(policies)).length,
    payments: (await db.select().from(payments)).length,
    bundles: (await db.select().from(bundles)).length,
    audit: (await db.select().from(auditLog)).length,
    jobs: (await db.select().from(jobs)).length,
    idempotencyKeys: (await db.select().from(idempotencyKeys)).length,
  };
}

const NOTHING = { policies: 0, payments: 0, bundles: 0, audit: 0, jobs: 0, idempotencyKeys: 0 };

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  // rateLimitSubject and the email's link read the whole auth env, which this project doesn't set
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Kerb <hello@example.com>");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
  vi.mocked(audit).mockClear();
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("payForQuote: annual", () => {
  it("writes one policy, one payment, the accepted quote, an audit row and the email", async () => {
    const { actor, quoteId, reference, email } = await pricedCarQuote();
    const result = await pay(actor, quoteId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.quoteId).toBe(quoteId);
    expect(result.data.policyReferences).toHaveLength(1);
    expect(result.data.policyReferences[0]).toMatch(/^KRB-\d{6}$/);

    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote).toMatchObject({
      status: "accepted",
      paymentPlan: "annual",
      detailsConfirmedAt: NOW,
      coverAcknowledgedAt: NOW,
    });
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    expect(item!.startDate).toBe(STARTS_ON);
    const [option] = await getDb()
      .select()
      .from(quoteItemOptions)
      .where(eq(quoteItemOptions.id, item!.selectedOptionId!));
    const addons = await getDb()
      .select()
      .from(quoteItemAddons)
      .where(eq(quoteItemAddons.quoteItemId, item!.id));
    const addonsPence = addons
      .filter((a) => a.selected)
      .reduce((sum, a) => sum + a.annualPricePence, 0);

    const rows = await getDb().select().from(policies);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reference: result.data.policyReferences[0],
      customerId: actor.customerId,
      quoteId,
      quoteItemId: item!.id,
      bundleId: null,
      product: "car",
      coverLevel: option!.coverLevel,
      status: "active",
      startsOn: STARTS_ON,
      endsOn: "2027-11-19",
      annualPremiumPence: option!.annualPremiumPence + addonsPence,
      compulsoryExcessPence: option!.compulsoryExcessPence,
      voluntaryExcessPence: item!.voluntaryExcessPence,
      termsAcceptedAt: NOW,
    });

    const paid = await getDb().select().from(payments);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      customerId: actor.customerId,
      quoteId,
      plan: "annual",
      instalmentNumber: 1,
      amountPence: quote!.totalPence,
      status: "succeeded",
      paidAt: NOW,
      cardBrand: "Visa",
      cardLast4: "4242",
      dueOn: STARTS_ON,
    });

    const audits = await getDb().select().from(auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "policy.purchased",
      entityType: "policy",
      entityId: rows[0]!.id,
      actorUserId: actor.userId,
      actorRole: "customer",
      changes: { quoteReference: reference, plan: "annual", amountPence: quote!.totalPence },
    });

    const queued = await getDb().select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.type).toBe("email.send");
    const payload = queued[0]!.payload as {
      to: string;
      template: string;
      params: Record<string, string>;
    };
    expect(payload).toMatchObject({
      to: email,
      template: "policy_confirmed",
      params: {
        name: "Alex",
        policyReference: result.data.policyReferences[0],
        startsOn: "20 November 2026",
        endsOn: "19 November 2027",
        url: "http://localhost:3000/account",
      },
    });
    expect(payload.params.car).toContain("Volkswagen Golf");
    expect(payload.params.amount).toContain("paid annually");
    // The job renders
    expect(renderEmail("policy_confirmed", payload.params).text).toContain(
      result.data.policyReferences[0],
    );
  });
});

describe("payForQuote: monthly", () => {
  it("writes 12 payments: the first taken now, 2 to 12 scheduled a month apart", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const result = await pay(actor, quoteId, { plan: "monthly" });
    expect(result.ok).toBe(true);

    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.paymentPlan).toBe("monthly");
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    const rate = new Tables(await getActiveRatingTables("car")).param("monthly_credit_charge_rate");
    expect(item!.ratingVersionId).toBe((await getActiveRatingTables("car")).id);
    const each = monthlyPayment(quote!.totalPence, rate);

    const paid = await getDb().select().from(payments).orderBy(payments.instalmentNumber);
    expect(paid).toHaveLength(12);
    const due = instalmentDates(STARTS_ON, 12);
    paid.forEach((p, i) => {
      expect(p).toMatchObject({
        plan: "monthly",
        instalmentNumber: i + 1,
        amountPence: each,
        status: i === 0 ? "succeeded" : "scheduled",
        paidAt: i === 0 ? NOW : null,
        dueOn: due[i],
        cardBrand: "Visa",
        cardLast4: "4242",
      });
    });
    const [row] = await getDb().select().from(auditLog);
    expect(row!.changes).toMatchObject({ plan: "monthly", amountPence: each });
  });
});

describe("payForQuote: once", () => {
  it("makes one policy for one key, however often it's sent, with the same answer", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const key = randomUUID();
    const first = await pay(actor, quoteId, {}, key);
    const second = await pay(actor, quoteId, {}, key);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await rowCounts()).toEqual({
      policies: 1,
      payments: 1,
      bundles: 0,
      audit: 1,
      jobs: 1,
      idempotencyKeys: 1,
    });
  });

  it("refuses a second purchase with another key", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    expect((await pay(actor, quoteId)).ok).toBe(true);
    await expect(pay(actor, quoteId)).resolves.toMatchObject({
      ok: false,
      error: { message: "You’ve already bought this quote." },
    });
    expect((await getDb().select().from(policies)).length).toBe(1);
  });

  it("makes exactly one policy from two tabs paying at once with different keys", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const results = await Promise.all([pay(actor, quoteId), pay(actor, quoteId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { message: "You’ve already bought this quote." },
    });
    expect(await rowCounts()).toMatchObject({ policies: 1, payments: 1, audit: 1, jobs: 1 });
  });
});

describe("payForQuote: failures", () => {
  it("rolls everything back when a step after the policy insert fails", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    vi.mocked(audit).mockRejectedValueOnce(new Error("forced"));
    await expect(pay(actor, quoteId)).rejects.toThrow("forced");
    expect(await rowCounts()).toEqual(NOTHING);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote).toMatchObject({ status: "priced", paymentPlan: null, detailsConfirmedAt: null });
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    // The save's tomorrow, unchanged
    expect(item!.startDate).toBe("2026-11-12");
  });

  it("refuses the declined demo card and writes nothing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await expect(
      pay(actor, quoteId, { card: { ...CARD, number: "4000 0000 0000 0002" } }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Your card was declined. Try another card.",
        fields: { "card.number": "Your card was declined. Try another card." },
      },
    });
    expect(await rowCounts()).toEqual(NOTHING);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.status).toBe("priced");
  });

  it("checks the card and the start date, and writes nothing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const result = await pay(actor, quoteId, {
      startsOn: "2026-12-12",
      card: { name: " ", number: "4242 4242 4242 4241", expiry: "10 / 26", code: "12" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fields: {
          "card.name": "Enter the name on the card.",
          "card.number": "Enter a valid card number.",
          "card.expiry": "This card has expired.",
          "card.code": "Enter the 3 or 4 digit security code.",
          startsOn: expect.any(String),
        },
      },
    });
    // Today is the earliest start
    const yesterday = await pay(actor, quoteId, { startsOn: "2026-11-10" });
    expect(yesterday).toMatchObject({
      ok: false,
      error: { fields: { startsOn: expect.any(String) } },
    });
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("needs both boxes ticked", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const result = await pay(actor, quoteId, { detailsConfirmed: false, coverAcknowledged: false });
    expect(result).toMatchObject({
      ok: false,
      error: {
        fields: { detailsConfirmed: expect.any(String), coverAcknowledged: expect.any(String) },
      },
    });
  });
});

describe("payForQuote: refusals", () => {
  it("refuses an expired quote", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(quotes)
      .set({ validUntil: new Date(NOW.getTime() - 1000) })
      .where(eq(quotes.id, quoteId));
    await expect(pay(actor, quoteId)).resolves.toMatchObject({
      ok: false,
      error: { message: "This quote has expired. Get a new quote to see today’s price." },
    });
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("refuses a referred quote", async () => {
    const journey = await golf();
    journey.claims!.incidents = [1, 2, 3].map((n) => ({
      ...journey.claims!.incidents[0]!,
      id: `i${n}`,
    }));
    const { actor, quoteId } = await pricedCarQuote(journey);
    await expect(pay(actor, quoteId)).resolves.toMatchObject({
      ok: false,
      error: { message: "This quote can’t be bought online." },
    });
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("treats another customer's quote as not found", async () => {
    const { quoteId } = await pricedCarQuote();
    const { actor: other } = await pricedCarQuote();
    await expect(pay(other, quoteId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A user with no customer row at all
    const stranger = (await resolveActor(getDb(), (await makeUser()).id))!;
    await expect(pay(stranger, quoteId)).rejects.toBeInstanceOf(AuthzError);
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("refuses an account that is closing", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .insert(accountClosures)
      .values({
        userId: actor.userId,
        requestedAt: NOW,
        closesAt: new Date(NOW.getTime() + 30 * 86_400_000),
      });
    await expect(pay(actor, quoteId)).resolves.toMatchObject({
      ok: false,
      error: { message: "Your account is closing, so you can’t buy a policy." },
    });
    expect((await getDb().select().from(policies)).length).toBe(0);
  });

  it("refuses staff", async () => {
    const staff = await makeStaff();
    const actor = (await resolveActor(getDb(), staff.userId))!;
    const verified = { ...actor, twoFactor: { enabled: true, verifiedAt: new Date() } };
    await expect(pay(verified, randomUUID())).resolves.toMatchObject({
      ok: false,
      error: { message: "Staff accounts can't buy policies." },
    });
  });
});

// A car and home quote, saved as save-quote.int.test.ts saves it (the car journey has one item
// until 5.7, so this is the bundle path's only caller here)
const carDetails = (): CarDetails => ({
  product: "car",
  vehicle: {
    make: "Volkswagen",
    model: "Golf",
    year: 2020,
    variant: "1.0 TSI Life 5dr",
    fuelType: "petrol",
    doors: 5,
    insuranceGroup: 14,
    valuePence: 2_000_000,
    catalogueVariantId: null,
    registration: "VW21 GQL",
    currentMileage: 18_200,
    annualMileage: 8_000,
    usage: "commuting",
    overnightLocation: "driveway",
  },
  drivers: [
    {
      firstName: "Alex",
      lastName: "Morgan",
      dateOfBirth: "1996-05-12",
      occupation: "teacher",
      licenceYears: 10,
      noClaimsYears: 5,
      pastClaims: 0,
    },
  ],
});

const homeDetails = (): HomeDetails => ({
  product: "home",
  property: {
    addressLine1: "18 Albion Road",
    town: "Leeds",
    postcode: "LS6 2AB",
    propertyType: "semi",
    yearBuilt: 1990,
    bedrooms: 3,
    rebuildCostPence: 24_000_000,
    contentsValuePence: 4_500_000,
    hasAlarm: false,
    hasSmokeAlarm: true,
    lockType: "multipoint",
    pastClaims: 0,
  },
});

describe("payForQuote: a bundle", () => {
  it("writes one bundle and two policies pointing at it", async () => {
    const customer = await makeCustomer();
    const requests: Omit<QuoteItemRequest, "tables">[] = [
      { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
      { product: "home", inputs: homeInputs(), coverLevel: "comprehensive", addons: [] },
    ];
    const priced = priceQuote(
      await Promise.all(
        requests.map(
          async (r) =>
            ({ ...r, tables: await getActiveRatingTables(r.product) }) as QuoteItemRequest,
        ),
      ),
    );
    const saved = await saveQuote(getDb(), {
      customerId: customer.id,
      postcode: "LS6 2AB",
      priced,
      items: [carDetails(), homeDetails()].map((details) => ({
        startDate: "2026-11-12",
        voluntaryExcessPence: 0,
        details,
      })),
      now: NOW,
    });
    const actor = (await resolveActor(getDb(), customer.userId))!;
    const result = await pay(actor, saved.quoteId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.policyReferences).toHaveLength(2);

    const bundleRows = await getDb().select().from(bundles);
    expect(bundleRows).toHaveLength(1);
    expect(bundleRows[0]).toMatchObject({ customerId: customer.id, quoteId: saved.quoteId });
    const rows = await getDb().select().from(policies);
    expect(rows.map((p) => p.product).sort()).toEqual(["car", "home"]);
    expect(rows.every((p) => p.bundleId === bundleRows[0]!.id)).toBe(true);
    expect(new Set(rows.map((p) => p.reference)).size).toBe(2);
    // One payment covers the quote; one audit row per policy; one email
    expect(await rowCounts()).toMatchObject({ payments: 1, audit: 2, jobs: 1 });
  });
});

describe("payForQuote: card details", () => {
  it("never stores the card number or security code", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const code = "9876";
    expect((await pay(actor, quoteId, { card: { ...CARD, code } })).ok).toBe(true);
    expect((await pay(actor, quoteId, { plan: "monthly", card: { ...CARD, code } })).ok).toBe(
      false,
    );

    for (const table of ["idempotency_keys", "audit_log", "jobs", "payments"]) {
      // Every column as text, so a json or numeric column is searched too
      const { rows } = await getOwnerDb().execute<{ row: string }>(
        sql.raw(`select t::text as row from ${table} t`),
      );
      expect(rows.length, table).toBeGreaterThan(0);
      for (const { row } of rows) {
        expect(row, table).not.toContain("4242424242424242");
        expect(row, table).not.toContain("4242 4242 4242 4242");
        // As a value or under a card key; a bare search would match digits in hashes and times
        expect(row, table).not.toContain(`"${code}"`);
        expect(row, table).not.toMatch(/"(code|number|expiry)"/);
      }
    }
  });
});
