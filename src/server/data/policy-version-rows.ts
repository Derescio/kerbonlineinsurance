import { desc, eq } from "drizzle-orm";

import { ageOn, todayIso } from "#/features/quote/schemas/dates";
import type { Db } from "#/server/db/client";
import { policies, policyVersions } from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

// The policy as it stands, as a policy_versions row stores it (6.3b, decision 9; v2 from 6.3c). `snapshot` is
// what Phase 9 may copy; names, dates of birth and the address go in `personal`, which it never
// does. The money is the policy page's (6.2): the selected tier's price, the chosen add-ons, the
// saving, the quote's total and the monthly instalment. 0027's backfill builds the same JSON in
// SQL for the policies bought before this slice, so the two must change together.

export interface SnapshotMoney {
  tierPence: number;
  addons: { addon: string; annualPricePence: number }[];
  /** This policy's share of a bundle or multi-policy saving; 0 without one */
  savingPence: number;
  /** Everything the customer pays for the year: premiums, IPT and fee */
  quoteTotalPence: number;
  /** A monthly plan's regular instalment; null when paid annually */
  instalmentPence: number | null;
}

/** A version as 6.3b wrote it, and as 0027's backfill wrote every policy's version 1 */
export interface PolicySnapshotV1 {
  snapshotVersion: 1;
  coverLevel: string;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  annualPremiumPence: number;
  money: SnapshotMoney;
  /** Main driver first, then named drivers in the order added; age on the version's date */
  drivers: { isMain: boolean; relationship: string | null; licenceYears: number; age: number }[];
  overnightLocation: string | null;
  /** The customer's district, even for a home insured elsewhere */
  postcodeDistrict: string | null;
}

/**
 * From 6.3c (decision 10): the car and the home are recorded too, and a home's district is the
 * insured home's. Written for every version from then on; older rows stay v1.
 */
export interface PolicySnapshotV2 extends Omit<PolicySnapshotV1, "snapshotVersion"> {
  snapshotVersion: 2;
  vehicle: {
    make: string;
    model: string;
    year: number;
    variant: string;
    insuranceGroup: number;
    valuePence: number;
    catalogueVariantId: string | null;
  } | null;
  property: {
    propertyType: string;
    contentsValuePence: number;
    valuablesPence: number | null;
    lockType: string;
    windowLocks: string | null;
    alarmType: string | null;
    hasSmokeAlarm: boolean;
  } | null;
}

export type PolicySnapshot = PolicySnapshotV1 | PolicySnapshotV2;

export interface PolicyPersonal {
  drivers: { firstName: string; lastName: string; dateOfBirth: string }[];
  /** Where the customer lives, or a home policy's insured address */
  address: { line1: string; line2: string | null; town: string; postcode: string };
  /** A car's plate; null for a home, or a car chosen without one */
  registration: string | null;
}

/** The policy's current details and money, read from its rows, with ages on `on` */
export async function readSnapshot(
  db: Db | Tx,
  policyId: string,
  on: Date,
): Promise<{ snapshot: PolicySnapshotV2; personal: PolicyPersonal }> {
  const row = await db.query.policies.findFirst({
    columns: {
      coverLevel: true,
      compulsoryExcessPence: true,
      voluntaryExcessPence: true,
      annualPremiumPence: true,
    },
    where: eq(policies.id, policyId),
    with: {
      customer: {
        columns: {
          addressLine1: true,
          addressLine2: true,
          town: true,
          postcode: true,
          postcodeDistrict: true,
        },
      },
      quote: {
        columns: { totalPence: true, paymentPlan: true, bundleDiscountPence: true },
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
              year: true,
              variant: true,
              insuranceGroup: true,
              valuePence: true,
              catalogueVariantId: true,
              registration: true,
              overnightLocation: true,
            },
          },
          property: {
            columns: {
              addressLine1: true,
              addressLine2: true,
              town: true,
              postcode: true,
              postcodeDistrict: true,
              propertyType: true,
              contentsValuePence: true,
              valuablesPence: true,
              lockType: true,
              windowLocks: true,
              alarmType: true,
              hasSmokeAlarm: true,
            },
          },
          drivers: {
            columns: {
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              isMain: true,
              licenceYears: true,
              relationship: true,
            },
            orderBy: (driver, { desc, asc }) => [
              desc(driver.isMain),
              asc(driver.createdAt),
              asc(driver.id),
            ],
          },
          selectedOption: { columns: { annualPremiumPence: true } },
          addons: {
            columns: { addon: true, annualPricePence: true },
            where: (addon, { eq }) => eq(addon.selected, true),
            orderBy: (addon, { asc }) => [asc(addon.addon)],
          },
        },
      },
    },
  });
  if (!row) throw new Error(`readSnapshot: no policy ${policyId}`);
  const { customer, quote, quoteItem } = row;
  const tierPence = quoteItem.selectedOption?.annualPremiumPence ?? 0;
  const addonsPence = quoteItem.addons.reduce((total, a) => total + a.annualPricePence, 0);
  const saving = Math.max(0, tierPence + addonsPence - row.annualPremiumPence);
  const [first, second] = quote.payments;
  const today = todayIso(on);
  const { vehicle, property } = quoteItem;
  // A home is placed where it is, not where its policyholder lives (6.3c, decision 10)
  const place = property
    ? {
        district: property.postcodeDistrict,
        address: {
          line1: property.addressLine1,
          line2: property.addressLine2,
          town: property.town,
          postcode: property.postcode,
        },
      }
    : {
        district: customer.postcodeDistrict,
        address: {
          line1: customer.addressLine1,
          line2: customer.addressLine2,
          town: customer.town,
          postcode: customer.postcode,
        },
      };
  return {
    snapshot: {
      snapshotVersion: 2,
      coverLevel: row.coverLevel,
      compulsoryExcessPence: row.compulsoryExcessPence,
      voluntaryExcessPence: row.voluntaryExcessPence,
      annualPremiumPence: row.annualPremiumPence,
      money: {
        tierPence,
        addons: quoteItem.addons,
        savingPence: (quote.bundleDiscountPence ?? 0) > 0 ? saving : 0,
        quoteTotalPence: quote.totalPence,
        instalmentPence:
          quote.paymentPlan === "monthly" && first ? (second ?? first).amountPence : null,
      },
      drivers: quoteItem.drivers.map((d) => ({
        isMain: d.isMain,
        relationship: d.relationship,
        licenceYears: d.licenceYears,
        age: ageOn(d.dateOfBirth, today),
      })),
      overnightLocation: vehicle?.overnightLocation ?? null,
      postcodeDistrict: place.district,
      vehicle: vehicle
        ? {
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            variant: vehicle.variant,
            insuranceGroup: vehicle.insuranceGroup,
            valuePence: vehicle.valuePence,
            catalogueVariantId: vehicle.catalogueVariantId,
          }
        : null,
      property: property
        ? {
            propertyType: property.propertyType,
            contentsValuePence: property.contentsValuePence,
            valuablesPence: property.valuablesPence,
            lockType: property.lockType,
            windowLocks: property.windowLocks,
            alarmType: property.alarmType,
            hasSmokeAlarm: property.hasSmokeAlarm,
          }
        : null,
    },
    personal: {
      drivers: quoteItem.drivers.map((d) => ({
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth,
      })),
      address: place.address,
      registration: vehicle?.registration ?? null,
    },
  };
}

/**
 * Records the policy as it now stands as `version`, in effect from `effectiveFrom`. A change passes
 * its `money` (6.3b, decision 2): the quote's price rows stay as sold, so after a change only the
 * change knows the policy's current tier price, add-on prices, saving, total and instalment.
 */
export async function writeVersion(
  tx: Db | Tx,
  policyId: string,
  version: number,
  policyChangeId: string | null,
  effectiveFrom: Date,
  money?: SnapshotMoney,
): Promise<void> {
  const read = await readSnapshot(tx, policyId, effectiveFrom);
  const snapshot = money ? { ...read.snapshot, money } : read.snapshot;
  const { personal } = read;
  await tx
    .insert(policyVersions)
    .values({ policyId, version, policyChangeId, effectiveFrom, snapshot, personal });
}

/** The policy's newest version: what the policy page's money is read from */
export async function latestVersion(
  db: Db | Tx,
  policyId: string,
): Promise<{ version: number; snapshot: PolicySnapshot }> {
  const [row] = await db
    .select({ version: policyVersions.version, snapshot: policyVersions.snapshot })
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policyId))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  if (!row) throw new Error(`latestVersion: policy ${policyId} has no version`);
  return { version: row.version, snapshot: row.snapshot as PolicySnapshot };
}
