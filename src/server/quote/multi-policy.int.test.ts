import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { completeHomeJourney, completeJourney } from "#/features/quote/journey-fixtures";
import type { Journey } from "#/features/quote/journey-store";
import { resolveActor } from "#/server/auth/actor";
import { purchaseItems } from "#/server/data/pay-quote";
import { clearReferenceCaches, getCatalogue, upsertReferenceData } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import {
  bundles,
  policies,
  quoteItemAddons,
  quoteItemOptions,
  quoteItems,
  quotes,
} from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { env } from "#/test/auth";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeCustomer, makePolicy, makeUser } from "#/test/factories";
import { fakeStripe } from "#/test/stripe-fake";

import { startCheckout, type CheckoutDeps } from "./checkout";
import { saveBundleQuoteFor, saveCarQuoteFor, saveHomeQuoteFor } from "./save";

// Adding the other product (6.1b): 8% off one item while an active policy of the other product
// still runs, recorded on the quote, and dropped before Stripe if that policy no longer qualifies.

const NOW = new Date("2026-11-11T12:00:00Z");
const STARTS_ON = "2026-11-20";
const ctx = { headers: new Headers() };
const stripe = fakeStripe();
const deps: CheckoutDeps = { stripe, testClocks: false, now: NOW };

beforeAll(async () => {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  await truncateExcept(REFERENCE_TABLES);
  clearReferenceCaches();
  stripe.reset();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function holder(product: "car" | "home") {
  const user = await makeUser();
  const customer = await makeCustomer({ userId: user.id });
  const policy = await makePolicy({ customerId: customer.id, product });
  return { user, customer, policy };
}

async function golf(): Promise<Journey> {
  const journey = completeJourney();
  const row = (await getCatalogue(getDb())).find(
    (r) => r.make === "Volkswagen" && r.model === "Golf" && r.year === 2021,
  )!;
  journey.vehicle = { ...journey.vehicle!, variant: row.variant, catalogueVariantId: row.id };
  return journey;
}

async function savedHome(userId: string) {
  const saved = await withTx(getDb(), (tx) =>
    saveHomeQuoteFor(tx, userId, { journey: completeHomeJourney(), now: NOW }),
  );
  if (saved.status !== "saved") throw new Error(`home not saved: ${saved.status}`);
  return saved.quoteId;
}

async function savedCar(userId: string) {
  const journey = await golf();
  const saved = await withTx(getDb(), (tx) => saveCarQuoteFor(tx, userId, { journey, now: NOW }));
  if (saved.status !== "saved") throw new Error(`car not saved: ${saved.status}`);
  return saved.quoteId;
}

async function quoteRow(quoteId: string) {
  const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId));
  const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  const [option] = await getDb()
    .select()
    .from(quoteItemOptions)
    .where(eq(quoteItemOptions.id, item!.selectedOptionId!));
  const addons = await getDb()
    .select()
    .from(quoteItemAddons)
    .where(eq(quoteItemAddons.quoteItemId, item!.id));
  return { quote: quote!, item: item!, option: option!, addons };
}

describe("one product, while the other is already held", () => {
  it("takes 8% off a home quote and leaves the car policy alone", async () => {
    const { user, policy } = await holder("car");
    const quoteId = await savedHome(user.id);
    const { quote, option, addons } = await quoteRow(quoteId);
    const addonPence = addons
      .filter((addon) => addon.selected)
      .reduce((sum, addon) => sum + addon.annualPricePence, 0);
    expect(quote.bundleDiscountPence).toBe(Math.round(option.annualPremiumPence * 0.08));
    expect(quote.bundleDiscountPence).toBeGreaterThan(0);
    expect(quote.bundlePolicyId).toBe(policy.id);
    expect(quote.totalPence).toBe(
      quote.subtotalPence - quote.bundleDiscountPence + quote.feesPence + quote.iptPence,
    );
    expect(await getDb().select().from(bundles)).toEqual([]);
    const [held] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(held!.annualPremiumPence).toBe(50_000);

    const bought = await withTx(getDb(), (tx) => purchaseItems(tx, quoteId));
    expect(bought).toHaveLength(1);
    expect(bought[0]!.annualPremiumPence).toBe(
      option.annualPremiumPence - quote.bundleDiscountPence + addonPence,
    );
  });

  it("takes 8% off a car quote when the home policy is active", async () => {
    const { user, policy } = await holder("home");
    const quoteId = await savedCar(user.id);
    const { quote } = await quoteRow(quoteId);
    expect(quote.bundleDiscountPence).toBeGreaterThan(0);
    expect(quote.bundlePolicyId).toBe(policy.id);
  });

  it.each([
    ["cancelled", { status: "cancelled" as const, cancelledAt: NOW }],
    ["lapsed", { status: "lapsed" as const }],
    ["ended", { startsOn: "2026-10-01", endsOn: "2026-11-10" }],
  ])("gives no saving when the car policy is %s", async (_label, patch) => {
    const { user, policy } = await holder("car");
    await getDb().update(policies).set(patch).where(eq(policies.id, policy.id));
    const quoteId = await savedHome(user.id);
    const { quote } = await quoteRow(quoteId);
    expect(quote.bundleDiscountPence).toBe(0);
    expect(quote.bundlePolicyId).toBeNull();
  });

  it("records the earliest active policy of the other product", async () => {
    const { user, customer, policy: earlier } = await holder("home");
    const later = await makePolicy({ customerId: customer.id, product: "home" });
    await getDb()
      .update(policies)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(policies.id, earlier.id));
    await getDb()
      .update(policies)
      .set({ createdAt: new Date("2026-06-01T00:00:00Z") })
      .where(eq(policies.id, later.id));
    const quoteId = await savedCar(user.id);
    const { quote } = await quoteRow(quoteId);
    expect(quote.bundlePolicyId).toBe(earlier.id);
  });

  it("does not stack the saving onto a quote that already has both products", async () => {
    const { user } = await holder("car");
    const home = completeHomeJourney();
    home.homeAbout = {
      firstName: "Alex",
      lastName: "Morgan",
      dateOfBirth: "1991-05-12",
      status: "employed",
      occupation: "plumber",
    };
    const car = await golf();
    const saved = await withTx(getDb(), (tx) =>
      saveBundleQuoteFor(tx, user.id, { car, home, now: NOW }),
    );
    if (saved.status !== "saved") throw new Error(`bundle not saved: ${saved.status}`);
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, saved.quoteId));
    // The two-item split still applies. The bundles row is written at purchase, not here.
    expect(quote!.bundlePolicyId).toBeNull();
    expect(quote!.bundleDiscountPence).toBeGreaterThan(0);
    expect(await getDb().select().from(bundles)).toEqual([]);
  });
});

describe("startCheckout drops the saving before any charge", () => {
  it("reprices when the earning policy is cancelled, then charges the full price", async () => {
    const { user, policy } = await holder("car");
    const quoteId = await savedHome(user.id);
    const before = await quoteRow(quoteId);
    await getDb()
      .update(policies)
      .set({ status: "cancelled", cancelledAt: NOW })
      .where(eq(policies.id, policy.id));
    const actor = (await resolveActor(getDb(), user.id))!;
    const input = {
      quoteId,
      plan: "annual" as const,
      startsOn: STARTS_ON,
      detailsConfirmed: true,
      coverAcknowledged: true,
    };
    const first = await startCheckout(actor, { input, idempotencyKey: randomUUID() }, ctx, deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toEqual({ status: "repriced", otherProduct: "car" });
    expect(stripe.calls["checkout.sessions.create"] ?? []).toHaveLength(0);
    const dropped = await quoteRow(quoteId);
    expect(dropped.quote.bundleDiscountPence).toBe(0);
    expect(dropped.quote.bundlePolicyId).toBeNull();
    expect(dropped.quote.totalPence).toBeGreaterThan(before.quote.totalPence);
    const [held] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(held!.annualPremiumPence).toBe(50_000);

    const second = await startCheckout(actor, { input, idempotencyKey: randomUUID() }, ctx, deps);
    expect(second.ok && second.data.status === "ready").toBe(true);
    if (!second.ok || second.data.status !== "ready") return;
    const created = stripe.calls["checkout.sessions.create"] ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]?.[0]).toMatchObject({
      line_items: [{ price_data: { unit_amount: dropped.quote.totalPence } }],
    });
  });
});
