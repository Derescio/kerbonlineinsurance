import { and, eq } from "drizzle-orm";
import { vi } from "vite-plus/test";

import { completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { instalmentDates } from "#/features/quote/policy-terms";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { getDb } from "#/server/db/client";
import { payments, policies, ratingVersions } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { purchase } from "#/server/quote/purchase";
import { saveCarQuoteFor } from "#/server/quote/save";
import { priceQuote, type QuoteItemRequest } from "#/features/rating/price-quote";
import { carInputs, homeInputs } from "#/features/rating/test-tables";
import { getActiveRatingTables, getRatingTables } from "#/server/data/reference";
import { saveQuote } from "#/server/data/save-quote";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import type { RatingSource } from "#/server/reference/rating/types";

import { SECRET } from "./auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "./db";
import { makeCustomer, makeUser } from "./factories";
import type { fakeStripe } from "./stripe-fake";

// A car policy bought the real way (6.3b): the frames' journey saved and priced on car v1, then
// purchase(), so its rows, money and version 1 are what a customer's would be. Cover runs from
// 20 Nov 2026 to 19 Nov 2027.

export const BOUGHT_AT = new Date("2026-11-11T12:00:00Z");
export const STARTS_ON = "2026-11-20";

/** Env the purchase email reads, and the reference data; call from beforeAll */
export async function setUpPolicyWorld(extraRating: readonly RatingSource[] = []): Promise<void> {
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
    rating: structuredClone([...RATING_SOURCES, ...extraRating]),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
}

/** Everything but the reference data; call from beforeEach */
export async function resetPolicyWorld(): Promise<void> {
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
}

/** The frames' journey with the catalogue's 2021 Golf */
export async function golfJourney(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

type Bought = { actor: Actor; policy: typeof policies.$inferSelect };

async function buy(actor: Actor, quoteId: string, plan: "annual" | "monthly"): Promise<void> {
  const monthly = plan === "monthly";
  const result = await withTx(getDb(), (tx) =>
    purchase(tx, {
      userId: actor.userId,
      customerId: actor.customerId!,
      quoteId,
      plan,
      startsOn: STARTS_ON,
      detailsConfirmedAt: BOUGHT_AT,
      coverAcknowledgedAt: BOUGHT_AT,
      card: { brand: "Visa", last4: "4242" },
      stripe: monthly
        ? {
            subscriptionId: `sub_${quoteId}`,
            invoiceId: `in_${quoteId}`,
            paymentIntentId: `pi_${quoteId}`,
            instalmentDates: instalmentDates("2026-11-11", 12),
          }
        : { paymentIntentId: `pi_${quoteId}` },
      auditActor: actor,
      now: BOUGHT_AT,
    }),
  );
  if (result.status !== "bought") throw new Error(`not bought: ${result.status}`);
}

/** A car + home bundle bought together (5.7b): one quote, one payment or subscription */
export async function boughtBundle(plan: "annual" | "monthly" = "monthly"): Promise<{
  actor: Actor;
  car: typeof policies.$inferSelect;
  home: typeof policies.$inferSelect;
}> {
  const customer = await makeCustomer();
  const requests: Omit<QuoteItemRequest, "tables">[] = [
    { product: "car", inputs: carInputs(), coverLevel: "comprehensive", addons: [] },
    { product: "home", inputs: homeInputs(), coverLevel: "comprehensive", addons: [] },
  ];
  const priced = priceQuote(
    await Promise.all(
      requests.map(
        async (r) => ({ ...r, tables: await getActiveRatingTables(r.product) }) as QuoteItemRequest,
      ),
    ),
  );
  const saved = await saveQuote(getDb(), {
    customerId: customer.id,
    postcode: "LS6 2AB",
    priced,
    items: [
      {
        startDate: STARTS_ON,
        voluntaryExcessPence: 0,
        details: {
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
          priorClaims: [],
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
        },
      },
      {
        startDate: STARTS_ON,
        voluntaryExcessPence: 0,
        details: {
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
            // Priced on home v2, which rates the policyholder's occupation (5.7c)
            employmentStatus: "employed",
            occupation: "doctor",
          },
          priorClaims: [],
        },
      },
    ],
    now: BOUGHT_AT,
  });
  const actor = (await resolveActor(getDb(), customer.userId))!;
  await buy(actor, saved.quoteId, plan);
  const rows = await getDb().select().from(policies).where(eq(policies.quoteId, saved.quoteId));
  return {
    actor,
    car: rows.find((p) => p.product === "car")!,
    home: rows.find((p) => p.product === "home")!,
  };
}

/**
 * A home policy bought on its own (6.3c): 18 Albion Road, Leeds, priced on home v2 (the active
 * version), or on home v1 with no occupation stored, as a home bought before 5.7c was. The
 * customer lives elsewhere, so a home's own address can be told apart from theirs.
 */
export async function boughtHomePolicy({
  plan = "annual",
  rating = "v2",
}: { plan?: "annual" | "monthly"; rating?: "v1" | "v2" } = {}): Promise<Bought> {
  const customer = await makeCustomer({ postcode: "M1 1AE", addressLine1: "9 Elsewhere Road" });
  const [v1] = await getDb()
    .select({ id: ratingVersions.id })
    .from(ratingVersions)
    .where(and(eq(ratingVersions.product, "home"), eq(ratingVersions.version, 1)));
  const tables =
    rating === "v1" ? await getRatingTables(getDb(), v1!.id) : await getActiveRatingTables("home");
  const inputs = homeInputs(rating === "v1" ? { occupation: "" } : {});
  const priced = priceQuote([
    { product: "home", inputs, tables, coverLevel: "comprehensive", addons: [] },
  ]);
  const saved = await saveQuote(getDb(), {
    customerId: customer.id,
    postcode: "LS6 2AB",
    priced,
    items: [
      {
        startDate: STARTS_ON,
        voluntaryExcessPence: 0,
        details: {
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
            ...(rating === "v2"
              ? {
                  valuablesPence: 500_000,
                  windowLocks: "all_accessible",
                  alarmType: "none",
                  employmentStatus: "employed",
                  occupation: "doctor",
                }
              : {}),
          },
          priorClaims: [],
        },
      },
    ],
    now: BOUGHT_AT,
  });
  const actor = (await resolveActor(getDb(), customer.userId))!;
  await buy(actor, saved.quoteId, plan);
  const [policy] = await getDb().select().from(policies).where(eq(policies.quoteId, saved.quoteId));
  return { actor, policy: policy! };
}

export async function boughtCarPolicy({
  plan = "annual",
  journey,
}: { plan?: "annual" | "monthly"; journey?: Journey } = {}): Promise<Bought> {
  const user = await makeUser();
  const answers = journey ?? (await golfJourney());
  const saved = await withTx(getDb(), (tx) =>
    saveCarQuoteFor(tx, user.id, { journey: answers, now: BOUGHT_AT }),
  );
  if (saved.status !== "saved") throw new Error(`not saved: ${saved.status}`);
  const actor = (await resolveActor(getDb(), user.id))!;
  await buy(actor, saved.quoteId, plan);
  const [policy] = await getDb().select().from(policies).where(eq(policies.quoteId, saved.quoteId));
  return { actor, policy: policy! };
}

/**
 * The bought quote's subscription as the Stripe fake holds it: one item priced at the regular
 * instalment. Returns that instalment.
 */
export async function presetSubscription(
  stripe: ReturnType<typeof fakeStripe>,
  quoteId: string,
): Promise<number> {
  const [row] = await getDb()
    .select()
    .from(payments)
    .where(and(eq(payments.quoteId, quoteId), eq(payments.instalmentNumber, 2)));
  stripe.set("subscriptions.retrieve", `sub_${quoteId}`, {
    metadata: { kerb_env: "local" },
    items: { data: [{ id: "si_1", price: { unit_amount: row!.amountPence, product: "prod_1" } }] },
  });
  return row!.amountPence;
}
