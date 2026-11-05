import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "#/server/db/client";
import {
  businesses,
  claims,
  customers,
  drivers,
  payments,
  policies,
  properties,
  quoteItemAddons,
  quoteItemOptions,
  quoteItems,
  quotes,
  ratingVersions,
  staffMembers,
  staffRoles,
  underwritingDecisions,
  users,
  vehicles,
} from "#/server/db/schema";
import type { Product, StaffRole } from "#/server/db/schema/values";

// Test factories (4.2): each inserts one valid row, and its parents when they aren't given, with
// any field overridable. 4.5's permission suite and later slices build on them. Integration tests
// only: they write through getDb() to the test database.

let sequence = 0;
const next = () => ++sequence;
const digits = (length: number) => String(next()).padStart(length, "0");

type Insert<T extends { $inferInsert: unknown }> = Partial<T["$inferInsert"]>;

export async function makeUser(overrides: Insert<typeof users> = {}) {
  const n = next();
  const [user] = await getDb()
    .insert(users)
    .values({
      id: randomUUID(),
      name: `Test User ${n}`,
      email: `user${n}@example.test`,
      ...overrides,
    })
    .returning();
  return user!;
}

export async function makeCustomer(overrides: Insert<typeof customers> = {}) {
  const userId = overrides.userId ?? (await makeUser()).id;
  const [customer] = await getDb()
    .insert(customers)
    .values({
      userId,
      firstName: "Alex",
      lastName: "Taylor",
      dateOfBirth: "1990-04-12",
      addressLine1: "1 Test Street",
      town: "London",
      postcode: "SW1A 1AA",
      ...overrides,
    })
    .returning();
  return customer!;
}

export async function makeStaff({
  roles = ["claims_handler"],
  ...overrides
}: Insert<typeof staffMembers> & { roles?: StaffRole[] } = {}) {
  const userId = overrides.userId ?? (await makeUser()).id;
  const [staff] = await getDb()
    .insert(staffMembers)
    .values({
      userId,
      displayName: "Sam from Kerb claims",
      staffCode: `H-${digits(3).slice(-3)}`,
      ...overrides,
    })
    .returning();
  if (roles.length > 0) {
    await getDb()
      .insert(staffRoles)
      .values(roles.map((role) => ({ userId, role })));
  }
  return { ...staff!, roles: roles as string[] };
}

export async function makeRatingVersion(overrides: Insert<typeof ratingVersions> = {}) {
  const [version] = await getDb()
    .insert(ratingVersions)
    .values({ product: "car", version: next(), effectiveFrom: "2026-01-01", ...overrides })
    .returning();
  return version!;
}

const tiers = [
  { coverLevel: "essential", coverMultiplier: "0.9000", annual: 40000 },
  { coverLevel: "comprehensive", coverMultiplier: "1.0000", annual: 50000 },
  { coverLevel: "plus", coverMultiplier: "1.2000", annual: 60000 },
] as const;

async function addDetails(quoteItemId: string, product: Product) {
  const db = getDb();
  if (product === "car") {
    await db.insert(vehicles).values({
      quoteItemId,
      make: "Volkswagen",
      model: "Golf",
      year: 2019,
      variant: "1.5 TSI Life",
      fuelType: "petrol",
      doors: 5,
      insuranceGroup: 17,
      valuePence: 1_400_000,
      registration: "AB19 CDE",
      currentMileage: 42_000,
      annualMileage: 8_000,
      usage: "commuting",
      overnightLocation: "driveway",
    });
    await db.insert(drivers).values({
      quoteItemId,
      isMain: true,
      firstName: "Alex",
      lastName: "Taylor",
      dateOfBirth: "1990-04-12",
      occupation: "teacher",
      licenceYears: 10,
      noClaimsYears: 6,
    });
  } else if (product === "home") {
    await db.insert(properties).values({
      quoteItemId,
      addressLine1: "1 Test Street",
      town: "London",
      postcode: "SW1A 1AA",
      propertyType: "terraced",
      yearBuilt: 1930,
      bedrooms: 3,
      rebuildCostPence: 30_000_000,
      contentsValuePence: 4_000_000,
      hasAlarm: true,
      hasSmokeAlarm: true,
      lockType: "five_lever",
    });
  } else {
    await db.insert(businesses).values({
      quoteItemId,
      tradeClass: "consultancy",
      turnoverPence: 12_000_000,
      employees: 3,
      coverSections: ["public_liability"],
    });
  }
}

/**
 * A priced quote: one quoted item per product, each with every tier offered (comprehensive
 * selected), a breakdown add-on on car items, and its detail rows. Totals reconcile.
 */
export async function makeQuote({
  products = ["car"],
  ...overrides
}: Insert<typeof quotes> & { products?: Product[] } = {}) {
  const db = getDb();
  const customerId = overrides.customerId ?? (await makeCustomer()).id;
  const [quote] = await db
    .insert(quotes)
    .values({
      reference: `KRB-Q-${digits(5)}`,
      status: "priced",
      postcode: "SW1A 1AA",
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...overrides,
      customerId,
    })
    .returning();

  const items = [];
  let subtotalPence = 0;
  for (const product of products) {
    const ratingVersion = await makeRatingVersion({ product });
    const [item] = await db
      .insert(quoteItems)
      .values({
        quoteId: quote!.id,
        product,
        ratingVersionId: ratingVersion.id,
        outcome: "quoted",
        startDate: "2026-12-01",
      })
      .returning();
    const options = await db
      .insert(quoteItemOptions)
      .values(
        tiers.map((tier) => ({
          quoteItemId: item!.id,
          coverLevel: tier.coverLevel,
          coverMultiplier: tier.coverMultiplier,
          compulsoryExcessPence: 25_000,
          annualPremiumPence: tier.annual,
          monthlyPremiumPence: Math.ceil(tier.annual / 12),
        })),
      )
      .returning();
    const selected = options.find((option) => option.coverLevel === "comprehensive")!;
    const [updated] = await db
      .update(quoteItems)
      .set({ selectedOptionId: selected.id })
      .where(eq(quoteItems.id, item!.id))
      .returning();
    subtotalPence += selected.annualPremiumPence;
    if (product === "car") {
      await db.insert(quoteItemAddons).values({
        quoteItemId: item!.id,
        addon: "breakdown_uk",
        annualPricePence: 4_500,
        monthlyPricePence: 375,
      });
    }
    await addDetails(item!.id, product);
    items.push({ item: updated!, options, selected });
  }

  const iptPence = Math.round(subtotalPence * 0.12);
  const [priced] = await db
    .update(quotes)
    .set({ subtotalPence, iptPence, totalPence: subtotalPence + iptPence })
    .where(eq(quotes.id, quote!.id))
    .returning();
  return { quote: priced!, items };
}

/**
 * A live policy bought from a quote's item: a new car quote unless `quoteItemId` is given (its
 * quote is looked up when `quoteId` isn't).
 */
export async function makePolicy(overrides: Insert<typeof policies> = {}) {
  let { customerId, quoteId, quoteItemId } = overrides;
  let product = (overrides.product ?? "car") as Product;
  if (!quoteItemId) {
    const { quote, items } = await makeQuote({ products: [product], customerId });
    customerId = quote.customerId;
    quoteId = quote.id;
    quoteItemId = items[0]!.item.id;
    product = items[0]!.item.product as Product;
  } else if (!quoteId) {
    const [item] = await getDb().select().from(quoteItems).where(eq(quoteItems.id, quoteItemId));
    quoteId = item!.quoteId;
    product = item!.product as Product;
  }
  const [policy] = await getDb()
    .insert(policies)
    .values({
      reference: `KRB-${digits(6)}`,
      coverLevel: "comprehensive",
      startsOn: "2026-12-01",
      endsOn: "2027-11-30",
      annualPremiumPence: 50_000,
      compulsoryExcessPence: 25_000,
      termsAcceptedAt: new Date(),
      ...overrides,
      customerId: customerId!,
      quoteId,
      quoteItemId,
      product,
    })
    .returning();
  return policy!;
}

/** An annual payment for a quote (a new priced quote unless `quoteId` is given). */
export async function makePayment(overrides: Insert<typeof payments> = {}) {
  let { customerId, quoteId } = overrides;
  if (!quoteId) {
    const { quote } = await makeQuote({ customerId });
    customerId = quote.customerId;
    quoteId = quote.id;
  }
  const [payment] = await getDb()
    .insert(payments)
    .values({
      plan: "annual",
      instalmentNumber: 1,
      amountPence: 56_000,
      status: "succeeded",
      cardBrand: "visa",
      cardLast4: "4242",
      dueOn: "2026-12-01",
      paidAt: new Date(),
      ...overrides,
      customerId: customerId!,
      quoteId,
    })
    .returning();
  return payment!;
}

/** A claim on a policy. A `draft` claim leaves the incident fields empty; any other status fills them. */
export async function makeClaim({ status = "received", ...overrides }: Insert<typeof claims> = {}) {
  let { policyId, customerId } = overrides;
  if (!policyId) {
    const policy = await makePolicy({ customerId });
    policyId = policy.id;
    customerId = policy.customerId;
  }
  const incident =
    status === "draft"
      ? {}
      : {
          incidentAt: new Date("2026-11-20T08:30:00Z"),
          incidentLocation: "A4 Bath Road, Reading",
          description: "Another car reversed into mine at the lights.",
          declarationAcceptedAt: new Date(),
          submittedAt: new Date(),
        };
  const [claim] = await getDb()
    .insert(claims)
    .values({
      reference: `KRB-C-${digits(5)}`,
      status,
      incidentType: "collision",
      ...incident,
      ...overrides,
      policyId,
      customerId: customerId!,
    })
    .returning();
  return claim!;
}

/** A car quote item referred to a handler, with the automatic underwriting decision that referred it. */
export async function makeReferral({ customerId }: { customerId?: string } = {}) {
  const { quote, items } = await makeQuote({ customerId });
  const [item] = await getDb()
    .update(quoteItems)
    .set({ outcome: "referred", reasonCode: "high_value_vehicle" })
    .where(eq(quoteItems.id, items[0]!.item.id))
    .returning();
  await getDb().insert(underwritingDecisions).values({
    quoteItemId: item!.id,
    outcome: "referred",
    reasonCode: "high_value_vehicle",
    decidedBy: null,
  });
  return { quote, item: item! };
}
