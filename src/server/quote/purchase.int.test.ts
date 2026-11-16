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
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { SECRET } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer, makeStaff, makeUser } from "#/test/factories";

import { purchase, type PurchaseInput, type PurchaseResult } from "./purchase";
import { saveCarQuoteFor } from "./save";

// The real audit(), with a spy so one test can make it throw after the policy insert
vi.mock("#/server/audit/audit", async (original) => {
  const real = await original<typeof import("#/server/audit/audit")>();
  return { ...real, audit: vi.fn(real.audit) };
});

// The purchase (5.6, decision 7; moved into purchase() by 5.6b, decision 6): one transaction
// writes the policies, the payments, a bundle for two items, the accepted quote, the audit rows
// and the email job. Two purchases at once make one policy, and a failure part-way leaves nothing.
// The card is what Stripe's payment method says (brand and last four), and the Stripe ids go on
// the payments.

// The journey fixture's dates hold on 11 Nov 2026; cover may start up to 30 days on
const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const CARD = { brand: "Visa", last4: "4242" };
const ANNUAL_STRIPE = { paymentIntentId: "pi_test_1" };
// Stripe bills from the purchase day, not the cover start (5.6b, decision 3)
const BILLING_DATES = instalmentDates("2026-11-11", 12);
const MONTHLY_STRIPE = {
  subscriptionId: "sub_test_1",
  invoiceId: "in_test_1",
  paymentIntentId: "pi_test_2",
  instalmentDates: BILLING_DATES,
};
// A customer id no row has
const NO_CUSTOMER = "00000000-0000-7000-8000-000000000000";

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

const input = (
  actor: Actor,
  quoteId: string,
  overrides: Partial<PurchaseInput> = {},
): PurchaseInput => ({
  userId: actor.userId,
  customerId: actor.customerId ?? NO_CUSTOMER,
  quoteId,
  plan: "annual",
  startsOn: STARTS_ON,
  detailsConfirmedAt: NOW,
  coverAcknowledgedAt: NOW,
  card: CARD,
  stripe: overrides.plan === "monthly" ? MONTHLY_STRIPE : ANNUAL_STRIPE,
  auditActor: actor,
  now: NOW,
  ...overrides,
});

const buy = (
  actor: Actor,
  quoteId: string,
  overrides: Partial<PurchaseInput> = {},
): Promise<PurchaseResult> =>
  withTx(getDb(), (tx) => purchase(tx, input(actor, quoteId, overrides)));

async function rowCounts() {
  const db = getDb();
  return {
    policies: (await db.select().from(policies)).length,
    payments: (await db.select().from(payments)).length,
    bundles: (await db.select().from(bundles)).length,
    audit: (await db.select().from(auditLog)).length,
    jobs: (await db.select().from(jobs)).length,
  };
}

const NOTHING = { policies: 0, payments: 0, bundles: 0, audit: 0, jobs: 0 };

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  // The email's link reads the whole auth env, which this project doesn't set
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

describe("purchase: annual", () => {
  it("writes one policy, one payment, the accepted quote, an audit row and the email", async () => {
    const { actor, quoteId, reference, email } = await pricedCarQuote();
    const result = await buy(actor, quoteId);
    expect(result.status).toBe("bought");
    if (result.status !== "bought") return;
    expect(result.quoteId).toBe(quoteId);
    expect(result.policyReferences).toHaveLength(1);
    expect(result.policyReferences[0]).toMatch(/^KRB-\d{6}$/);

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
      reference: result.policyReferences[0],
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
      stripePaymentIntentId: "pi_test_1",
      stripeInvoiceId: null,
      stripeSubscriptionId: null,
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
    expect(queued[0]!.id).toBe(result.jobId);
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
        policyReference: result.policyReferences[0],
        startsOn: "20 November 2026",
        endsOn: "19 November 2027",
        url: "http://localhost:3000/account",
      },
    });
    expect(payload.params.car).toContain("Volkswagen Golf");
    expect(payload.params.amount).toContain("paid annually");
    // The job renders
    expect(renderEmail("policy_confirmed", payload.params).text).toContain(
      result.policyReferences[0],
    );
  });

  it("keeps each confirmation time the checkout recorded", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const details = new Date("2026-11-11T11:50:00Z");
    const cover = new Date("2026-11-11T11:51:00Z");
    await buy(actor, quoteId, { detailsConfirmedAt: details, coverAcknowledgedAt: cover });
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote).toMatchObject({ detailsConfirmedAt: details, coverAcknowledgedAt: cover });
    const [policy] = await getDb().select().from(policies);
    expect(policy!.termsAcceptedAt).toEqual(cover);
  });

  it("audits as the system when there's no actor (the webhook)", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    expect((await buy(actor, quoteId, { auditActor: null })).status).toBe("bought");
    const [row] = await getDb().select().from(auditLog);
    expect(row).toMatchObject({ action: "policy.purchased", actorUserId: null });
  });
});

describe("purchase: monthly", () => {
  it("writes 12 payments on Stripe's billing dates: the first taken now, 2 to 12 scheduled", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const result = await buy(actor, quoteId, { plan: "monthly" });
    expect(result.status).toBe("bought");

    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote!.paymentPlan).toBe("monthly");
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    const rate = new Tables(await getActiveRatingTables("car")).param("monthly_credit_charge_rate");
    expect(item!.ratingVersionId).toBe((await getActiveRatingTables("car")).id);
    const each = monthlyPayment(quote!.totalPence, rate);

    const paid = await getDb().select().from(payments).orderBy(payments.instalmentNumber);
    expect(paid).toHaveLength(12);
    paid.forEach((p, i) => {
      expect(p).toMatchObject({
        plan: "monthly",
        instalmentNumber: i + 1,
        amountPence: each,
        status: i === 0 ? "succeeded" : "scheduled",
        paidAt: i === 0 ? NOW : null,
        dueOn: BILLING_DATES[i],
        cardBrand: "Visa",
        cardLast4: "4242",
        stripeSubscriptionId: "sub_test_1",
        // Only the first invoice exists yet
        stripeInvoiceId: i === 0 ? "in_test_1" : null,
        stripePaymentIntentId: i === 0 ? "pi_test_2" : null,
      });
    });
    const [row] = await getDb().select().from(auditLog);
    expect(row!.changes).toMatchObject({ plan: "monthly", amountPence: each });
  });

  it("dates the payments from the cover start when no billing dates are given", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await buy(actor, quoteId, { plan: "monthly", stripe: { subscriptionId: "sub_test_1" } });
    const paid = await getDb().select().from(payments).orderBy(payments.instalmentNumber);
    expect(paid.map((p) => p.dueOn)).toEqual(instalmentDates(STARTS_ON, 12));
  });
});

describe("purchase: once", () => {
  it("refuses a second purchase", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    expect((await buy(actor, quoteId)).status).toBe("bought");
    await expect(
      buy(actor, quoteId, { stripe: { paymentIntentId: "pi_test_9" } }),
    ).resolves.toEqual({ status: "refused", message: "You’ve already bought this quote." });
    expect((await getDb().select().from(policies)).length).toBe(1);
  });

  it("makes exactly one policy from two purchases at once", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    const results = await Promise.all([
      buy(actor, quoteId),
      buy(actor, quoteId, { stripe: { paymentIntentId: "pi_test_9" } }),
    ]);
    expect(results.filter((r) => r.status === "bought")).toHaveLength(1);
    expect(results.find((r) => r.status !== "bought")).toEqual({
      status: "refused",
      message: "You’ve already bought this quote.",
    });
    expect(await rowCounts()).toMatchObject({ policies: 1, payments: 1, audit: 1, jobs: 1 });
  });
});

describe("purchase: failures", () => {
  it("rolls everything back when a step after the policy insert fails", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    vi.mocked(audit).mockRejectedValueOnce(new Error("forced"));
    await expect(buy(actor, quoteId)).rejects.toThrow("forced");
    expect(await rowCounts()).toEqual(NOTHING);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
    expect(quote).toMatchObject({ status: "priced", paymentPlan: null, detailsConfirmedAt: null });
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    // The save's tomorrow, unchanged
    expect(item!.startDate).toBe("2026-11-12");
  });
});

describe("purchase: refusals", () => {
  const EXPIRED = "This quote has expired. Get a new quote to see today’s price.";

  it("refuses an expired quote", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(quotes)
      .set({ validUntil: new Date(NOW.getTime() - 1000) })
      .where(eq(quotes.id, quoteId));
    await expect(buy(actor, quoteId)).resolves.toEqual({ status: "refused", message: EXPIRED });
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("honours an expired quote when the checkout started before it expired", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    await getDb()
      .update(quotes)
      .set({ validUntil: new Date(NOW.getTime() - 1000) })
      .where(eq(quotes.id, quoteId));
    await expect(buy(actor, quoteId, { allowExpired: true })).resolves.toMatchObject({
      status: "bought",
    });
    // The daily job's "expired" status too
    const other = await pricedCarQuote();
    await getDb().update(quotes).set({ status: "expired" }).where(eq(quotes.id, other.quoteId));
    await expect(
      buy(other.actor, other.quoteId, {
        allowExpired: true,
        stripe: { paymentIntentId: "pi_test_9" },
      }),
    ).resolves.toMatchObject({ status: "bought" });
  });

  it("refuses a referred quote", async () => {
    const journey = await golf();
    journey.claims!.incidents = [1, 2, 3].map((n) => ({
      ...journey.claims!.incidents[0]!,
      id: `i${n}`,
    }));
    const { actor, quoteId } = await pricedCarQuote(journey);
    await expect(buy(actor, quoteId)).resolves.toEqual({
      status: "refused",
      message: "This quote can’t be bought online.",
    });
    expect(await rowCounts()).toEqual(NOTHING);
  });

  it("treats another customer's quote as not found", async () => {
    const { quoteId } = await pricedCarQuote();
    const { actor: other } = await pricedCarQuote();
    await expect(buy(other, quoteId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A user with no customer row at all
    const stranger = (await resolveActor(getDb(), (await makeUser()).id))!;
    await expect(buy(stranger, quoteId)).rejects.toBeInstanceOf(AuthzError);
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
    await expect(buy(actor, quoteId)).resolves.toEqual({
      status: "refused",
      message: "Your account is closing, so you can’t buy a policy.",
    });
    expect((await getDb().select().from(policies)).length).toBe(0);
  });

  it("lets staff buy like anyone else", async () => {
    const staff = await makeStaff();
    const journey = await golf();
    const saved = await withTx(getDb(), (tx) =>
      saveCarQuoteFor(tx, staff.userId, { journey, now: NOW }),
    );
    if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
    const actor = (await resolveActor(getDb(), staff.userId))!;
    await expect(buy(actor, saved.quoteId)).resolves.toMatchObject({ status: "bought" });
    expect(await getDb().select().from(policies)).toHaveLength(1);
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
  priorClaims: [],
});

describe("purchase: a bundle", () => {
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
    const result = await buy(actor, saved.quoteId);
    expect(result.status).toBe("bought");
    if (result.status !== "bought") return;
    expect(result.policyReferences).toHaveLength(2);

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

describe("purchase: card details", () => {
  it("keeps only the brand and last four, never a card number", async () => {
    const { actor, quoteId } = await pricedCarQuote();
    expect((await buy(actor, quoteId)).status).toBe("bought");

    for (const table of ["audit_log", "jobs", "payments"]) {
      // Every column as text, so a json or numeric column is searched too
      const { rows } = await getOwnerDb().execute<{ row: string }>(
        sql.raw(`select t::text as row from ${table} t`),
      );
      expect(rows.length, table).toBeGreaterThan(0);
      for (const { row } of rows) {
        expect(row, table).not.toContain("4242424242424242");
        expect(row, table).not.toContain("4242 4242 4242 4242");
        expect(row, table).not.toMatch(/"(code|number|expiry|cvc)"/);
      }
    }
  });
});
