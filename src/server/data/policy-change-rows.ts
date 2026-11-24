import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import type { NewDriver, PolicyChangeRequest } from "#/features/policy-changes/request";
import { wholeYearsBetween } from "#/features/quote/schemas/dates";
import type { Db } from "#/server/db/client";
import {
  customers,
  drivers,
  payments,
  policies,
  policyChanges,
  properties,
  quoteItemAddons,
  quoteItemOptions,
  quoteItems,
  quotes,
  users,
  vehicles,
} from "#/server/db/schema";
import type { CoverLevel } from "#/server/db/schema/values";
import type { Tx } from "#/server/db/tx";
import type { PolicyRatingRows } from "#/server/policy-changes/inputs";

// The rows behind a policy change (6.3b): the policy locked with everything it's rated from, the
// customer's other policies that change what's allowed, the policy_changes row, and the in-place
// updates a change makes (decision 2). The protected writes in src/server/policy-changes/ call
// these; nothing here checks who is asking.

export interface StoredPolicy extends PolicyRatingRows {
  policy: {
    id: string;
    reference: string;
    customerId: string;
    quoteId: string;
    quoteItemId: string;
    bundleId: string | null;
    product: string;
    status: string;
    startsOn: string;
    endsOn: string;
    coverLevel: CoverLevel;
    compulsoryExcessPence: number;
    voluntaryExcessPence: number;
    annualPremiumPence: number;
    version: number;
  };
  ratingVersionId: string;
  quote: { paymentPlan: string | null; bundleDiscountPence: number };
  customer: { firstName: string; email: string; addressLine1: string };
  /** Named drivers as the dialogs and audit see them */
  driverRelationships: Map<string, string | null>;
  /** Every driver's name, for the email */
  driverNames: Map<string, string>;
  failedInstalments: number;
  scheduledInstalments: number;
}

/** The customer's policy id by reference; null when it isn't theirs */
export async function myPolicyId(
  tx: Tx,
  reference: string,
  customerId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.reference, reference), eq(policies.customerId, customerId)));
  return row?.id ?? null;
}

/**
 * The policy, locked until the transaction ends, with everything a change is rated from. Null for
 * a policy that isn't a car (the caller refuses it): only car policies change online.
 */
export async function loadPolicyForChange(tx: Tx, policyId: string): Promise<StoredPolicy | null> {
  const [policy] = await tx.select().from(policies).where(eq(policies.id, policyId)).for("update");
  if (!policy || policy.product !== "car") return null;

  const [item] = await tx
    .select({ ratingVersionId: quoteItems.ratingVersionId })
    .from(quoteItems)
    .where(eq(quoteItems.id, policy.quoteItemId));
  const [quote] = await tx
    .select({ paymentPlan: quotes.paymentPlan, bundleDiscountPence: quotes.bundleDiscountPence })
    .from(quotes)
    .where(eq(quotes.id, policy.quoteId));
  const [customer] = await tx
    .select({
      firstName: customers.firstName,
      postcode: customers.postcode,
      addressLine1: customers.addressLine1,
      email: users.email,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, policy.customerId));
  const [vehicle] = await tx
    .select()
    .from(vehicles)
    .where(eq(vehicles.quoteItemId, policy.quoteItemId));
  if (!vehicle) return null;
  const driverRows = await tx
    .select()
    .from(drivers)
    .where(eq(drivers.quoteItemId, policy.quoteItemId))
    .orderBy(sql`${drivers.isMain} desc`, asc(drivers.createdAt), asc(drivers.id));
  const addons = await tx
    .select({ addon: quoteItemAddons.addon })
    .from(quoteItemAddons)
    .where(
      and(eq(quoteItemAddons.quoteItemId, policy.quoteItemId), eq(quoteItemAddons.selected, true)),
    )
    .orderBy(asc(quoteItemAddons.addon));
  const instalments = await tx
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.quoteId, policy.quoteId));

  return {
    policy: {
      id: policy.id,
      reference: policy.reference,
      customerId: policy.customerId,
      quoteId: policy.quoteId,
      quoteItemId: policy.quoteItemId,
      bundleId: policy.bundleId,
      product: policy.product,
      status: policy.status,
      startsOn: policy.startsOn,
      endsOn: policy.endsOn,
      coverLevel: policy.coverLevel as CoverLevel,
      compulsoryExcessPence: policy.compulsoryExcessPence,
      voluntaryExcessPence: policy.voluntaryExcessPence,
      annualPremiumPence: policy.annualPremiumPence,
      version: policy.version,
    },
    ratingVersionId: item!.ratingVersionId,
    quote: {
      paymentPlan: quote!.paymentPlan,
      bundleDiscountPence: quote!.bundleDiscountPence ?? 0,
    },
    customer: {
      firstName: customer!.firstName,
      email: customer!.email,
      addressLine1: customer!.addressLine1,
    },
    postcode: customer!.postcode,
    coverLevel: policy.coverLevel as CoverLevel,
    addons: addons.map((a) => a.addon),
    voluntaryExcessPence: policy.voluntaryExcessPence,
    vehicle: {
      year: vehicle.year,
      insuranceGroup: vehicle.insuranceGroup,
      fuelType: vehicle.fuelType,
      valuePence: vehicle.valuePence,
      annualMileage: vehicle.annualMileage,
      usage: vehicle.usage,
      overnightLocation: vehicle.overnightLocation,
    },
    drivers: driverRows.map((d) => ({
      id: d.id,
      isMain: d.isMain,
      dateOfBirth: d.dateOfBirth,
      occupation: d.occupation,
      licenceYears: d.licenceYears,
      noClaimsYears: d.noClaimsYears,
      pastClaims: d.pastClaims,
    })),
    driverRelationships: new Map(
      driverRows.filter((d) => !d.isMain).map((d) => [d.id, d.relationship]),
    ),
    driverNames: new Map(driverRows.map((d) => [d.id, `${d.firstName} ${d.lastName}`])),
    failedInstalments: instalments.filter((p) => p.status === "failed").length,
    scheduledInstalments: instalments.filter((p) => p.status === "scheduled").length,
  };
}

/** Whether the customer has another car policy in force on `today` (decision 11) */
export async function hasOtherActiveCarPolicy(
  tx: Tx,
  customerId: string,
  policyId: string,
  today: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: policies.id })
    .from(policies)
    .where(
      and(
        eq(policies.customerId, customerId),
        eq(policies.product, "car"),
        eq(policies.status, "active"),
        ne(policies.id, policyId),
        gte(policies.endsOn, today),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The first line of the address an active home policy of the customer's insures, if any */
export async function activeHomeAddressLine(
  tx: Tx,
  customerId: string,
  today: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ line: properties.addressLine1 })
    .from(policies)
    .innerJoin(properties, eq(properties.quoteItemId, policies.quoteItemId))
    .where(
      and(
        eq(policies.customerId, customerId),
        eq(policies.product, "home"),
        eq(policies.status, "active"),
        gte(policies.endsOn, today),
      ),
    )
    .limit(1);
  return row?.line ?? null;
}

export type PolicyChangeRow = typeof policyChanges.$inferSelect;
export type NewPolicyChange = typeof policyChanges.$inferInsert;

export async function insertPolicyChange(tx: Tx, values: NewPolicyChange): Promise<string> {
  const [row] = await tx.insert(policyChanges).values(values).returning({ id: policyChanges.id });
  return row!.id;
}

/** The customer's change, locked; null when it isn't theirs */
export async function lockMyPolicyChange(
  tx: Tx,
  changeId: string,
  customerId: string,
): Promise<PolicyChangeRow | null> {
  const [row] = await tx
    .select()
    .from(policyChanges)
    .where(and(eq(policyChanges.id, changeId), eq(policyChanges.customerId, customerId)))
    .for("update");
  return row ?? null;
}

export async function updatePolicyChange(
  tx: Db | Tx,
  changeId: string,
  patch: Partial<NewPolicyChange>,
): Promise<void> {
  await tx.update(policyChanges).set(patch).where(eq(policyChanges.id, changeId));
}

/** What a change leaves the policy's own columns as */
export interface PolicyAfter {
  coverLevel: CoverLevel;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  annualPremiumPence: number;
}

/**
 * Makes the change to the bought quote item's rows and the customer (decision 2), and the policy's
 * own columns, with its version moved on. A bundle's shared quote postcode is left alone
 * (decision 11): car rating reads the customer's.
 */
export async function applyChangeRows(
  tx: Tx,
  stored: StoredPolicy,
  change: PolicyChangeRequest,
  after: PolicyAfter,
  version: number,
  today: string,
): Promise<void> {
  const { policy } = stored;
  switch (change.kind) {
    case "address":
      await tx
        .update(customers)
        .set({
          addressLine1: change.addressLine1,
          addressLine2: change.addressLine2,
          town: change.town,
          postcode: change.postcode,
        })
        .where(eq(customers.id, policy.customerId));
      if (!policy.bundleId) {
        await tx
          .update(quotes)
          .set({ postcode: change.postcode })
          .where(eq(quotes.id, policy.quoteId));
      }
      await tx
        .update(vehicles)
        .set({ overnightLocation: change.overnightLocation })
        .where(eq(vehicles.quoteItemId, policy.quoteItemId));
      break;
    case "driver_added":
      await tx.insert(drivers).values(newDriverRow(policy.quoteItemId, change.driver, today));
      break;
    case "driver_removed":
      await tx
        .delete(drivers)
        .where(
          and(
            eq(drivers.id, change.driverId),
            eq(drivers.quoteItemId, policy.quoteItemId),
            eq(drivers.isMain, false),
          ),
        );
      break;
    case "cover": {
      const [option] = await tx
        .select({ id: quoteItemOptions.id })
        .from(quoteItemOptions)
        .where(
          and(
            eq(quoteItemOptions.quoteItemId, policy.quoteItemId),
            eq(quoteItemOptions.coverLevel, change.coverLevel),
          ),
        );
      await tx
        .update(quoteItems)
        .set({
          ...(option ? { selectedOptionId: option.id } : {}),
          voluntaryExcessPence: change.voluntaryExcessPence,
        })
        .where(eq(quoteItems.id, policy.quoteItemId));
      await tx
        .update(quoteItemAddons)
        .set({ selected: false })
        .where(eq(quoteItemAddons.quoteItemId, policy.quoteItemId));
      if (change.addons.length) {
        await tx
          .update(quoteItemAddons)
          .set({ selected: true })
          .where(
            and(
              eq(quoteItemAddons.quoteItemId, policy.quoteItemId),
              inArray(quoteItemAddons.addon, change.addons),
            ),
          );
      }
      break;
    }
  }
  await tx
    .update(policies)
    .set({ ...after, version })
    .where(eq(policies.id, policy.id));
}

function newDriverRow(quoteItemId: string, driver: NewDriver, today: string) {
  return {
    quoteItemId,
    isMain: false,
    firstName: driver.firstName,
    lastName: driver.lastName,
    dateOfBirth: driver.dateOfBirth,
    occupation: driver.occupation,
    licenceYears: wholeYearsBetween(driver.licenceDate, today),
    // Named drivers have no no-claims years of their own, and only one with no claims is added
    noClaimsYears: 0,
    pastClaims: 0,
    licenceType: driver.licenceType,
    employmentStatus: driver.employmentStatus,
    relationship: driver.relationship,
  };
}

// ---- Settling in Stripe (decision 5) ---------------------------------------------------------

/** The customer's Stripe customer id, and what a new one is made with */
export async function stripeCustomerOf(
  tx: Tx,
  customerId: string,
): Promise<{ stripeCustomerId: string | null; name: string; email: string }> {
  const [row] = await tx
    .select({
      stripeCustomerId: customers.stripeCustomerId,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: users.email,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  return {
    stripeCustomerId: row!.stripeCustomerId,
    name: `${row!.firstName} ${row!.lastName}`.trim(),
    email: row!.email,
  };
}

/** The policy's change waiting for its top-up, if any (one at most, decision 7) */
export async function openChangeFor(tx: Tx, policyId: string): Promise<PolicyChangeRow | null> {
  const [row] = await tx
    .select()
    .from(policyChanges)
    .where(and(eq(policyChanges.policyId, policyId), eq(policyChanges.status, "awaiting_payment")));
  return row ?? null;
}

/** The change a top-up session pays for, locked */
export async function lockChangeBySession(
  tx: Tx,
  sessionId: string,
): Promise<PolicyChangeRow | null> {
  const [row] = await tx
    .select()
    .from(policyChanges)
    .where(eq(policyChanges.stripeSessionId, sessionId))
    .for("update");
  return row ?? null;
}

/**
 * The payment intents a refund can come from, in order: the purchase's, then each applied
 * top-up's, newest first
 */
export async function refundablePaymentIntents(
  tx: Tx,
  quoteId: string,
  policyId: string,
): Promise<string[]> {
  const [first] = await tx
    .select({ id: payments.stripePaymentIntentId })
    .from(payments)
    .where(and(eq(payments.quoteId, quoteId), eq(payments.instalmentNumber, 1)));
  const topUps = await tx
    .select({ id: policyChanges.stripePaymentIntentId })
    .from(policyChanges)
    .where(
      and(
        eq(policyChanges.policyId, policyId),
        eq(policyChanges.status, "applied"),
        eq(policyChanges.settlement, "charge"),
      ),
    )
    .orderBy(sql`${policyChanges.appliedAt} desc`);
  return [first?.id, ...topUps.map((t) => t.id)].filter((id): id is string => Boolean(id));
}

/**
 * Moves every scheduled instalment of the quote by `deltaPence` (never below 1p). Returns the
 * subscription they're paid by and the regular instalment now, which Stripe is sent as an
 * absolute amount (so a retried transaction sends the same one)
 */
export async function shiftScheduledInstalments(
  tx: Tx,
  quoteId: string,
  deltaPence: number,
): Promise<{ subscriptionId: string | null; instalmentPence: number } | null> {
  const rows = await tx
    .update(payments)
    .set({ amountPence: sql`greatest(1, ${payments.amountPence} + ${deltaPence})` })
    .where(and(eq(payments.quoteId, quoteId), eq(payments.status, "scheduled")))
    .returning({
      subscriptionId: payments.stripeSubscriptionId,
      amountPence: payments.amountPence,
      instalmentNumber: payments.instalmentNumber,
    });
  if (!rows.length) return null;
  const next = rows.reduce((a, b) => (b.instalmentNumber < a.instalmentNumber ? b : a));
  return { subscriptionId: next.subscriptionId, instalmentPence: next.amountPence };
}

/** The customer's change, unlocked (the top-up check locks it in its own transaction) */
export async function myChange(
  db: Db | Tx,
  changeId: string,
  customerId: string,
): Promise<{ status: string; stripeSessionId: string | null } | null> {
  const [row] = await db
    .select({ status: policyChanges.status, stripeSessionId: policyChanges.stripeSessionId })
    .from(policyChanges)
    .where(and(eq(policyChanges.id, changeId), eq(policyChanges.customerId, customerId)));
  return row ?? null;
}
