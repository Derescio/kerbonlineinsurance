import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { todayIso, wholeYearsBetween } from "#/features/quote/schemas/dates";
import { audit, type AuditEntry } from "#/server/audit/audit";
import type { Actor } from "#/server/auth/actor";
import {
  applyChangeRows,
  updatePolicyChange,
  type StoredPolicy,
} from "#/server/data/policy-change-rows";
import { latestVersion, writeVersion, type SnapshotMoney } from "#/server/data/policy-version-rows";
import type { Tx } from "#/server/db/tx";

import type { PricedChange } from "./price";

// Applying a priced change (6.3b, decisions 2, 8 and 9): the rows updated in place, the policy's
// version moved on with a policy_versions snapshot of it as it now stands, an audit row with no
// names or full addresses, and the change marked applied, all in the caller's transaction. Kerbie
// (7.5) makes its changes through this too; it never prices or writes on its own.

type Quoted = Extract<PricedChange, { outcome: "quoted" }>;

const postcodeArea = (postcode: string) => /^[A-Z]{1,2}/.exec(postcode.toUpperCase())![0];

/**
 * The version's money: the last version's, moved by the change. Add-ons kept keep their price,
 * added ones take today's; the saving moves by the change in discount; the tier is what's left of
 * the new annual premium, so tier + add-ons − saving is always the policy's premium.
 */
function moneyAfter(prev: SnapshotMoney, priced: Quoted, chosen: string[]): SnapshotMoney {
  const addons = chosen
    .map((addon) => {
      const kept = prev.addons.find((a) => a.addon === addon);
      const today = priced.after.addons.find((a) => a.addon === addon);
      return kept ?? (today && { addon, annualPricePence: today.annualPricePence });
    })
    .filter((a): a is { addon: string; annualPricePence: number } => Boolean(a))
    .sort((a, b) => a.addon.localeCompare(b.addon));
  const savingPence = Math.max(
    0,
    prev.savingPence + priced.after.discountPence - priced.before.discountPence,
  );
  const addonsPence = addons.reduce((sum, a) => sum + a.annualPricePence, 0);
  return {
    tierPence: priced.newAnnualPence + savingPence - addonsPence,
    addons,
    savingPence,
    quoteTotalPence: prev.quoteTotalPence + priced.diffPence,
    instalmentPence:
      prev.instalmentPence === null
        ? null
        : prev.instalmentPence + (priced.settlement === "instalments" ? priced.amountPence : 0),
  };
}

function auditEntry(stored: StoredPolicy, change: PolicyChangeRequest, today: string) {
  switch (change.kind) {
    case "address":
      return {
        action: "policy.address_changed",
        changes: {
          postcode_area: { from: postcodeArea(stored.postcode), to: postcodeArea(change.postcode) },
          overnight_location: {
            from: stored.vehicle.overnightLocation,
            to: change.overnightLocation,
          },
        },
      } as const;
    case "driver_added":
      return {
        action: "policy.driver_added",
        changes: {
          relationship: change.driver.relationship,
          licence_years: wholeYearsBetween(change.driver.licenceDate, today),
        },
      } as const;
    case "driver_removed":
      return {
        action: "policy.driver_removed",
        changes: { relationship: stored.driverRelationships.get(change.driverId) ?? null },
      } as const;
    case "cover":
      return {
        action: "policy.cover_changed",
        changes: {
          cover_level: { from: stored.coverLevel, to: change.coverLevel },
          addons: {
            added: change.addons.filter((a) => !stored.addons.includes(a)).sort(),
            removed: stored.addons.filter((a) => !change.addons.includes(a)).sort(),
          },
          voluntary_excess_pence: {
            from: stored.voluntaryExcessPence,
            to: change.voluntaryExcessPence,
          },
        },
      } as const;
  }
}

export async function changePolicy(
  tx: Tx,
  input: {
    stored: StoredPolicy;
    change: PolicyChangeRequest;
    priced: Quoted;
    changeId: string;
    actor: Actor | null;
    now: Date;
  },
): Promise<{ version: number }> {
  const { stored, change, priced, changeId, actor, now } = input;
  const today = todayIso(now);
  const version = stored.policy.version + 1;
  const prev = (await latestVersion(tx, stored.policy.id)).snapshot.money;

  await applyChangeRows(
    tx,
    stored,
    change,
    {
      coverLevel: priced.after.coverLevel,
      compulsoryExcessPence: priced.after.compulsoryExcessPence,
      voluntaryExcessPence:
        change.kind === "cover" ? change.voluntaryExcessPence : stored.voluntaryExcessPence,
      annualPremiumPence: priced.newAnnualPence,
    },
    version,
    today,
  );
  const chosen = change.kind === "cover" ? change.addons : stored.addons;
  await writeVersion(
    tx,
    stored.policy.id,
    version,
    changeId,
    now,
    moneyAfter(prev, priced, chosen),
  );
  const { action, changes } = auditEntry(stored, change, today);
  await audit(tx, {
    actor,
    action,
    entityId: stored.policy.id,
    changes: changes as unknown as AuditEntry["changes"],
  });
  await updatePolicyChange(tx, changeId, { status: "applied", toVersion: version, appliedAt: now });
  return { version };
}
