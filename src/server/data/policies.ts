import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { todayIso } from "#/features/quote/schemas/dates";
import { AuthzError } from "#/server/auth/errors";
import { payments, policies, properties, quotes, vehicles } from "#/server/db/schema";

import type { ClaimSummary } from "./claims";
import type { Db } from "#/server/db/client";

import { defineRead } from "./define";
import { claimSummaryColumns } from "./summaries";

// The signed-in customer's own policies (4.5). Every query filters by actor.customerId, so someone
// else's policy is indistinguishable from a missing one.

export interface PolicySummary {
  id: string;
  reference: string;
  product: string;
  coverLevel: string;
  status: string;
  startsOn: string;
  endsOn: string;
}

/** What a policy insures, for the Overview's rows (6.1, decision 5); null with no detail row */
export type PolicyLabel =
  | { kind: "car"; plate: string | null; make: string; model: string }
  | { kind: "home"; line1: string; town: string }
  | null;

/**
 * A listed policy, whether it's paid monthly by a Stripe subscription (5.6b, decision 9), the
 * car + home bundle it was bought in, with the saving that quote gave (5.7b), the saving an
 * earlier policy earned it (6.1b), what it insures and its yearly premium (6.1)
 */
export type PolicyListItem = PolicySummary & {
  monthly: boolean;
  bundle: { id: string; savingPence: number } | null;
  /** Bought while `policyId`, the other product, was active: 8% off this one (6.1b) */
  earnedBy: { policyId: string; savingPence: number } | null;
  label: PolicyLabel;
  annualPremiumPence: number;
};

/** The insured car, as policy detail and the documents show it (6.2) */
export interface PolicyCar {
  make: string;
  model: string;
  variant: string;
  year: number;
  registration: string | null;
  valuePence: number;
  usage: string;
}

/** A driver on a car policy; `relationship` is null for the main driver and pre-5.7c rows */
export interface PolicyDriver {
  firstName: string;
  lastName: string;
  isMain: boolean;
  licenceYears: number;
  relationship: string | null;
}

/** The insured home (6.2) */
export interface PolicyHome {
  addressLine1: string;
  addressLine2: string | null;
  town: string;
  postcode: string;
  propertyType: string;
  yearBuilt: number;
  bedrooms: number;
  rebuildCostPence: number;
  contentsValuePence: number;
  valuablesPence: number | null;
}

/**
 * One policy, for its detail page and its certificate and schedule (6.2, decisions 3–8). What it
 * insures is the quote item's snapshot, which no later quote changes.
 */
export type PolicyDetail = PolicySummary & {
  annualPremiumPence: number;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  autoRenew: boolean;
  /** The London day it was bought: the documents' date until policy_versions (6.3) */
  boughtOn: string;
  policyholder: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2: string | null;
    town: string;
    postcode: string;
  };
  car: PolicyCar | null;
  /** Main driver first */
  drivers: PolicyDriver[];
  home: PolicyHome | null;
  /** The chosen tier's yearly premium, before any saving and add-ons */
  coverPremiumPence: number;
  addons: { addon: string; annualPricePence: number }[];
  /** This policy's part of its quote's saving: a same-quote bundle's share, or one an earlier policy earned (6.1b) */
  saving: { kind: "bundle" | "earned"; pence: number } | null;
  bundled: boolean;
  /** Monthly: the instalment, which covers every policy on the quote (a bundle's car and home) */
  plan: { kind: "monthly"; instalmentPence: number } | { kind: "annual" };
  /** The quote it was bought from, with what was paid for it in a year, IPT included */
  quote: { reference: string; totalPence: number };
  claims: ClaimSummary[];
};

const summaryColumns = {
  id: true,
  reference: true,
  product: true,
  coverLevel: true,
  status: true,
  startsOn: true,
  endsOn: true,
} as const;

export const listMyPolicies = defineRead(
  "signed_in",
  z.object({}),
  async (actor, _input, db): Promise<PolicyListItem[]> => {
    if (!actor.customerId) return [];
    const rows = await db.query.policies.findMany({
      columns: {
        ...summaryColumns,
        quoteId: true,
        quoteItemId: true,
        bundleId: true,
        annualPremiumPence: true,
      },
      where: eq(policies.customerId, actor.customerId),
      orderBy: desc(policies.createdAt),
    });
    // Monthly means a Stripe subscription, which the portal can change the card on: 5.6's demo
    // monthly rows have none (ruling R12, as /account/billing decides)
    const subscribed = await db
      .selectDistinct({ quoteId: payments.quoteId })
      .from(payments)
      .where(
        and(eq(payments.customerId, actor.customerId), isNotNull(payments.stripeSubscriptionId)),
      );
    const monthlyQuotes = new Set(subscribed.map((row) => row.quoteId));
    // A bundle's saving is its quote's discount on the combined premiums. A one-item quote with
    // bundle_policy_id has the same column, earned by that earlier policy (6.1b, decision 6)
    const quoteIds = [...new Set(rows.map((r) => r.quoteId))];
    const savings = new Map(
      quoteIds.length
        ? (
            await db
              .select({
                id: quotes.id,
                savingPence: quotes.bundleDiscountPence,
                earnedBy: quotes.bundlePolicyId,
              })
              .from(quotes)
              .where(and(eq(quotes.customerId, actor.customerId), inArray(quotes.id, quoteIds)))
          ).map((q) => [q.id, { savingPence: q.savingPence ?? 0, earnedBy: q.earnedBy }])
        : [],
    );
    const labels = await labelsFor(
      db,
      rows.map((r) => r.quoteItemId),
    );
    return rows.map(({ quoteId, quoteItemId, bundleId, ...policy }) => {
      const saving = savings.get(quoteId);
      return {
        ...policy,
        monthly: monthlyQuotes.has(quoteId),
        bundle: bundleId ? { id: bundleId, savingPence: saving?.savingPence ?? 0 } : null,
        earnedBy:
          !bundleId && saving?.earnedBy
            ? { policyId: saving.earnedBy, savingPence: saving.savingPence }
            : null,
        label: labels.get(quoteItemId) ?? null,
      };
    });
  },
);

/** Each quote item's car or home, read from its detail row. The ids come from the actor's policies */
async function labelsFor(db: Db, quoteItemIds: string[]): Promise<Map<string, PolicyLabel>> {
  const labels = new Map<string, PolicyLabel>();
  if (quoteItemIds.length === 0) return labels;
  const [cars, homes] = await Promise.all([
    db
      .select({
        quoteItemId: vehicles.quoteItemId,
        plate: vehicles.registration,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(vehicles)
      .where(inArray(vehicles.quoteItemId, quoteItemIds)),
    db
      .select({
        quoteItemId: properties.quoteItemId,
        line1: properties.addressLine1,
        town: properties.town,
      })
      .from(properties)
      .where(inArray(properties.quoteItemId, quoteItemIds)),
  ]);
  for (const { quoteItemId, ...car } of cars) labels.set(quoteItemId, { kind: "car", ...car });
  for (const { quoteItemId, ...home } of homes) labels.set(quoteItemId, { kind: "home", ...home });
  return labels;
}

/** The Overview's "Next payment" card (6.1, decision 4) */
export type NextPayment =
  | { kind: "overdue"; outstandingPence: number }
  | { kind: "due"; amountPence: number; dueOn: string }
  | { kind: "none" };

/**
 * Unpaid and still owed: not taken yet, or taken and refused but not a month Kerb voided while the
 * cover had lapsed (isOwed, 5.6b decision 8). Only while the quote still has a policy in force or
 * lapsed: cancelling leaves the later instalments `scheduled`, and they're never taken.
 */
function owedBy(db: Db, customerId: string) {
  return and(
    eq(payments.customerId, customerId),
    or(
      eq(payments.status, "scheduled"),
      and(eq(payments.status, "failed"), isNull(payments.voidedAt)),
    ),
    exists(
      db
        .select({ id: policies.id })
        .from(policies)
        .where(
          and(
            eq(policies.quoteId, payments.quoteId),
            inArray(policies.status, ["active", "lapsed"]),
          ),
        ),
    ),
  );
}

/** The calendar day before an ISO date */
function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Overdue once the due date has passed. A `scheduled` payment gets the day after it was due before
 * that: Stripe may already have taken it, and the webhook can be a day late. A `failed` row is
 * already the webhook's answer, so it is overdue as soon as the due date has passed.
 */
function paymentOverdue(status: string, dueOn: string, today: string): boolean {
  if (dueOn >= today) return false;
  if (status === "failed") return true;
  return dueOn < dayBefore(today);
}

/**
 * Overdue payments first (their total), else the earliest unpaid payment that isn't overdue yet,
 * else none. `now` is for the tests.
 */
export const getMyNextPayment = defineRead(
  "signed_in",
  z.object({ now: z.date().optional() }),
  async (actor, { now }, db): Promise<NextPayment> => {
    if (!actor.customerId) return { kind: "none" };
    const today = todayIso(now ?? new Date());
    const rows = await db
      .select({
        amountPence: payments.amountPence,
        dueOn: payments.dueOn,
        status: payments.status,
      })
      .from(payments)
      .where(owedBy(db, actor.customerId))
      .orderBy(asc(payments.dueOn), asc(payments.id));
    const overdue = rows.filter((row) => paymentOverdue(row.status, row.dueOn, today));
    if (overdue.length > 0) {
      return {
        kind: "overdue",
        outstandingPence: overdue.reduce((total, row) => total + row.amountPence, 0),
      };
    }
    const next = rows[0];
    return next
      ? { kind: "due", amountPence: next.amountPence, dueOn: next.dueOn }
      : { kind: "none" };
  },
);

/** A policy reference as customers see it (policies_reference_check) */
export const policyReference = z.string().regex(/^KRB-\d{6}$/);

/** By the reference in its URL (6.2, decision 1); another customer's is as missing as an unknown one */
export const getMyPolicy = defineRead(
  "signed_in",
  z.object({ reference: policyReference }),
  async (actor, { reference }, db): Promise<PolicyDetail> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const row = await db.query.policies.findFirst({
      columns: {
        ...summaryColumns,
        annualPremiumPence: true,
        compulsoryExcessPence: true,
        voluntaryExcessPence: true,
        autoRenew: true,
        bundleId: true,
        createdAt: true,
      },
      where: and(eq(policies.reference, reference), eq(policies.customerId, actor.customerId)),
      with: {
        customer: {
          columns: {
            firstName: true,
            lastName: true,
            addressLine1: true,
            addressLine2: true,
            town: true,
            postcode: true,
          },
        },
        quote: {
          columns: {
            reference: true,
            totalPence: true,
            paymentPlan: true,
            bundleDiscountPence: true,
          },
          with: {
            payments: {
              columns: { amountPence: true },
              orderBy: (payment, { asc }) => [asc(payment.instalmentNumber)],
              limit: 2,
            },
          },
        },
        quoteItem: {
          columns: {},
          with: {
            vehicle: {
              columns: {
                make: true,
                model: true,
                variant: true,
                year: true,
                registration: true,
                valuePence: true,
                usage: true,
              },
            },
            drivers: {
              columns: {
                firstName: true,
                lastName: true,
                isMain: true,
                licenceYears: true,
                relationship: true,
              },
              orderBy: (driver, { desc, asc }) => [desc(driver.isMain), asc(driver.createdAt)],
            },
            property: {
              columns: {
                addressLine1: true,
                addressLine2: true,
                town: true,
                postcode: true,
                propertyType: true,
                yearBuilt: true,
                bedrooms: true,
                rebuildCostPence: true,
                contentsValuePence: true,
                valuablesPence: true,
              },
            },
            selectedOption: { columns: { annualPremiumPence: true } },
            addons: {
              columns: { addon: true, annualPricePence: true },
              where: (addon, { eq }) => eq(addon.selected, true),
              orderBy: (addon, { asc }) => [asc(addon.addon)],
            },
          },
        },
        claims: {
          columns: claimSummaryColumns,
          orderBy: (claim, { desc }) => [desc(claim.createdAt)],
        },
      },
    });
    if (!row) throw new AuthzError("NOT_FOUND");
    const { bundleId, createdAt, customer, quote, quoteItem, ...policy } = row;
    const coverPremiumPence = quoteItem.selectedOption?.annualPremiumPence ?? 0;
    const addonsPence = quoteItem.addons.reduce((total, a) => total + a.annualPricePence, 0);
    // The premium stored at purchase is the tier and add-ons less this policy's share of the saving
    const savingPence = Math.max(0, coverPremiumPence + addonsPence - policy.annualPremiumPence);
    const [first, second] = quote.payments;
    return {
      ...policy,
      boughtOn: todayIso(createdAt),
      policyholder: customer,
      car: quoteItem.vehicle ?? null,
      drivers: quoteItem.drivers,
      home: quoteItem.property ?? null,
      coverPremiumPence,
      addons: quoteItem.addons,
      saving:
        savingPence > 0 && (quote.bundleDiscountPence ?? 0) > 0
          ? { kind: bundleId ? "bundle" : "earned", pence: savingPence }
          : null,
      bundled: bundleId !== null,
      plan:
        quote.paymentPlan === "monthly" && first
          ? { kind: "monthly", instalmentPence: (second ?? first).amountPence }
          : { kind: "annual" },
      quote: { reference: quote.reference, totalPence: quote.totalPence },
    };
  },
);
