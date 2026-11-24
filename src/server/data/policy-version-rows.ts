import { desc, eq } from "drizzle-orm";

import { ageOn, todayIso } from "#/features/quote/schemas/dates";
import type { Db } from "#/server/db/client";
import { policies, policyVersions } from "#/server/db/schema";
import type { Tx } from "#/server/db/tx";

// The policy as it stands, as a policy_versions row stores it (6.3b, decision 9). `snapshot` is
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

export interface PolicySnapshot {
  snapshotVersion: 1;
  coverLevel: string;
  compulsoryExcessPence: number;
  voluntaryExcessPence: number;
  annualPremiumPence: number;
  money: SnapshotMoney;
  /** Main driver first, then named drivers in the order added; age on the version's date */
  drivers: { isMain: boolean; relationship: string | null; licenceYears: number; age: number }[];
  overnightLocation: string | null;
  postcodeDistrict: string | null;
}

export interface PolicyPersonal {
  drivers: { firstName: string; lastName: string; dateOfBirth: string }[];
  address: { line1: string; line2: string | null; town: string; postcode: string };
}

/** The policy's current details and money, read from its rows, with ages on `on` */
export async function readSnapshot(
  db: Db | Tx,
  policyId: string,
  on: Date,
): Promise<{ snapshot: PolicySnapshot; personal: PolicyPersonal }> {
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
          vehicle: { columns: { overnightLocation: true } },
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
  return {
    snapshot: {
      snapshotVersion: 1,
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
      overnightLocation: quoteItem.vehicle?.overnightLocation ?? null,
      postcodeDistrict: customer.postcodeDistrict,
    },
    personal: {
      drivers: quoteItem.drivers.map((d) => ({
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth,
      })),
      address: {
        line1: customer.addressLine1,
        line2: customer.addressLine2,
        town: customer.town,
        postcode: customer.postcode,
      },
    },
  };
}

/** Records the policy as it now stands as `version`, in effect from `effectiveFrom` */
export async function writeVersion(
  tx: Db | Tx,
  policyId: string,
  version: number,
  policyChangeId: string | null,
  effectiveFrom: Date,
): Promise<void> {
  const { snapshot, personal } = await readSnapshot(tx, policyId, effectiveFrom);
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
