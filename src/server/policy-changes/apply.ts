import { todayIso, wholeYearsBetween } from "#/features/quote/schemas/dates";
import { audit, type AuditEntry } from "#/server/audit/audit";
import type { Actor } from "#/server/auth/actor";
import {
  applyChangeRows,
  carPolicy,
  homePolicy,
  type StoredHomePolicy,
  updatePolicyChange,
  type StoredPolicy,
} from "#/server/data/policy-change-rows";
import { latestVersion, writeVersion, type SnapshotMoney } from "#/server/data/policy-version-rows";
import type { Tx } from "#/server/db/tx";
import { authUrls } from "#/server/auth/origins";
import { getAuthEnv } from "#/server/env";
import { logSafeError } from "#/server/auth/errors";
import { jobsDb } from "#/server/data/job-rows";
import { jobDeps } from "#/server/jobs/deps";
import { queueEmail, runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";
import { emailPriceLine } from "#/features/policy-changes/money";
import { addonCopy } from "#/features/quote/cover";
import {
  alarmOptions,
  lockTypeOptions,
  windowLockOptions,
} from "#/features/quote/schemas/home-steps";
import { tierName } from "#/features/quote/labels";
import { formatPounds } from "#/features/rating/money";

import type { PricedChange } from "./price";
import type { ResolvedChange } from "./resolve";

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

/** Whole pounds, as the email words a contents value: £45,000 */
const pounds = (pence: number) => formatPounds(pence).replace(".00", "");

const optionLabel = (options: { value: string; label: string }[], value: string) => {
  const label = options.find((o) => o.value === value)?.label ?? value;
  return label.charAt(0).toLowerCase() + label.slice(1);
};

/** The security answers a change moves, for the audit and the email (decision 6) */
function securityMoves(
  stored: StoredHomePolicy,
  change: Extract<ResolvedChange, { kind: "home_security" }>,
): { field: string; from: string | boolean | null; to: string | boolean; sentence: string }[] {
  const { property } = stored;
  const moves = [
    {
      field: "lock_type",
      from: property.lockType,
      to: change.lockType,
      sentence: `Main door lock: ${optionLabel(lockTypeOptions, change.lockType)}.`,
    },
    {
      field: "window_locks",
      from: property.windowLocks,
      to: change.windowLocks,
      sentence: `Window locks: ${optionLabel(windowLockOptions, change.windowLocks)}.`,
    },
    {
      field: "alarm_type",
      from: property.alarmType,
      to: change.alarmType,
      sentence: `Burglar alarm: ${optionLabel(alarmOptions, change.alarmType)}.`,
    },
    {
      field: "has_smoke_alarm",
      from: property.hasSmokeAlarm,
      to: change.hasSmokeAlarm,
      sentence: change.hasSmokeAlarm
        ? "Smoke alarms: fitted and working."
        : "Smoke alarms: not fitted.",
    },
  ];
  return moves.filter((m) => m.from !== m.to);
}

function auditEntry(stored: StoredPolicy, change: ResolvedChange, today: string) {
  switch (change.kind) {
    case "address": {
      const car = carPolicy(stored);
      return {
        action: "policy.address_changed",
        changes: {
          postcode_area: { from: postcodeArea(car.postcode), to: postcodeArea(change.postcode) },
          overnight_location: {
            from: car.vehicle.overnightLocation,
            to: change.overnightLocation,
          },
        },
      } as const;
    }
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
    case "car_replaced": {
      // Make, model, year and group, never the plate (decision 3)
      const { vehicle } = carPolicy(stored);
      const { car } = change;
      return {
        action: "policy.car_changed",
        changes: {
          make: { from: vehicle.make, to: car.make },
          model: { from: vehicle.model, to: car.model },
          year: { from: vehicle.year, to: car.year },
          insurance_group: { from: vehicle.insuranceGroup, to: car.insuranceGroup },
        },
      } as const;
    }
    case "home_contents": {
      const { property } = homePolicy(stored);
      return {
        action: "policy.contents_changed",
        changes: {
          contents_value_pence: {
            from: property.contentsValuePence,
            to: change.contentsValuePence,
          },
          valuables_pence: { from: property.valuablesPence, to: change.valuablesPence },
        },
      } as const;
    }
    case "home_security": {
      return {
        action: "policy.security_changed",
        changes: Object.fromEntries(
          securityMoves(homePolicy(stored), change).map(({ field, from, to }) => [
            field,
            { from, to },
          ]),
        ),
      } as const;
    }
  }
}

/** The email's lines on what changed: every part of it */
function summaryOf(stored: StoredPolicy, change: ResolvedChange): string {
  switch (change.kind) {
    case "address":
      return `Your car is now kept at ${change.addressLine1}, ${change.postcode}.`;
    case "driver_added":
      return `${change.driver.firstName} ${change.driver.lastName} is now a named driver.`;
    case "driver_removed":
      return `${stored.driverNames.get(change.driverId) ?? "That driver"} is no longer a named driver.`;
    case "cover": {
      const parts: string[] = [];
      if (change.coverLevel !== stored.coverLevel) {
        parts.push(`Your cover is now ${tierName(change.coverLevel)}.`);
      }
      for (const addon of change.addons.filter((a) => !stored.addons.includes(a))) {
        parts.push(`${addonCopy(addon).label} added.`);
      }
      for (const addon of stored.addons.filter((a) => !change.addons.includes(a))) {
        parts.push(`${addonCopy(addon).label} removed.`);
      }
      if (change.voluntaryExcessPence !== stored.voluntaryExcessPence) {
        parts.push(
          `Voluntary excess now ${formatPounds(change.voluntaryExcessPence).replace(".00", "")}.`,
        );
      }
      return parts.join(" ");
    }
    case "car_replaced":
      return `Your car is now a ${change.car.make} ${change.car.model} (${change.car.year}).`;
    case "home_contents":
      return `Your contents are now covered for ${pounds(change.contentsValuePence)}, with valuables of ${pounds(change.valuablesPence)}.`;
    case "home_security":
      return [
        "Your home's security details are updated.",
        ...securityMoves(homePolicy(stored), change).map((m) => m.sentence),
      ].join(" ");
  }
}

/** The email's subject line on what changed */
function headlineOf(stored: StoredPolicy, change: ResolvedChange): string {
  switch (change.kind) {
    case "address":
      return "address changed";
    case "driver_added":
      return "driver added";
    case "driver_removed":
      return "driver removed";
    case "cover":
      return change.coverLevel !== stored.coverLevel
        ? `cover changed to ${tierName(change.coverLevel)}`
        : "cover changed";
    case "car_replaced":
      return "car changed";
    case "home_contents":
      return "contents updated";
    case "home_security":
      return "security updated";
  }
}

export async function changePolicy(
  tx: Tx,
  input: {
    stored: StoredPolicy;
    change: ResolvedChange;
    priced: Quoted;
    changeId: string;
    actor: Actor | null;
    now: Date;
  },
): Promise<{ version: number; emailJobId: number }> {
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
  const emailJobId = await queueEmail(
    tx,
    {
      to: stored.customer.email,
      template: "policy_changed",
      params: {
        name: stored.customer.firstName,
        policyReference: stored.policy.reference,
        summary: summaryOf(stored, change),
        headline: headlineOf(stored, change),
        priceLine: emailPriceLine(
          stored.quote.paymentPlan === "monthly" ? "monthly" : "annual",
          priced.settlement,
          priced.amountPence,
        ),
        url: `${authUrls(getAuthEnv()).baseURL}/account/policies/${stored.policy.reference}`,
      },
    },
    now,
  );
  return { version, emailJobId };
}

/** Sends a change's email once its transaction has committed; a failure is left for the cron */
export function sendChangeEmail(jobId: number | null, jobs?: JobDeps): void {
  if (jobId === null) return;
  try {
    runSoon(jobsDb(), jobId, jobs ?? jobDeps());
  } catch (error) {
    console.error("[policy-changes] queuing the email run failed:", logSafeError(error));
  }
}
