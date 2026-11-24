import { CANT_CHANGE_ONLINE } from "#/features/policy-changes/copy";
import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { hasOtherActiveCarPolicy, type StoredPolicy } from "#/server/data/policy-change-rows";
import type { RatingTables } from "#/server/data/reference";
import type { Tx } from "#/server/db/tx";

import { offeredAddons } from "./price";

// What can be changed online (6.3b, decisions 6, 11 to 13), checked when a change is priced, when
// it's confirmed, and again when a top-up's payment lands.

const NAMED_DRIVER_LIMIT = 4;

/** Why the policy can't be changed online right now, or null when it can (decision 6) */
export function ineligible(stored: StoredPolicy, today: string): string | null {
  const { policy } = stored;
  if (policy.status !== "active" || today >= policy.endsOn) return CANT_CHANGE_ONLINE;
  if (stored.quote.paymentPlan === "monthly" && stored.failedInstalments > 0) {
    return CANT_CHANGE_ONLINE;
  }
  return null;
}

/** Why this change can't be made online, or null */
export async function refusedChange(
  tx: Tx,
  stored: StoredPolicy,
  change: PolicyChangeRequest,
  tables: RatingTables,
  today: string,
): Promise<string | null> {
  switch (change.kind) {
    case "driver_added":
      return stored.driverRelationships.size >= NAMED_DRIVER_LIMIT ? CANT_CHANGE_ONLINE : null;
    case "driver_removed":
      return stored.driverRelationships.has(change.driverId) ? null : CANT_CHANGE_ONLINE;
    case "address":
      return (await hasOtherActiveCarPolicy(tx, stored.policy.customerId, stored.policy.id, today))
        ? CANT_CHANGE_ONLINE
        : null;
    case "cover": {
      const offered = new Set(offeredAddons(stored, tables, today).map((a) => a.addon));
      return change.addons.every((addon) => offered.has(addon)) ? null : CANT_CHANGE_ONLINE;
    }
  }
}

/** A cover or address change that leaves the policy as it is: nothing to price or confirm */
export function changesNothing(stored: StoredPolicy, change: PolicyChangeRequest): boolean {
  switch (change.kind) {
    case "cover":
      return (
        change.coverLevel === stored.coverLevel &&
        change.voluntaryExcessPence === stored.voluntaryExcessPence &&
        [...change.addons].sort().join() === [...stored.addons].sort().join()
      );
    case "address":
      return (
        change.postcode === stored.postcode &&
        change.addressLine1 === stored.customer.addressLine1 &&
        change.overnightLocation === stored.vehicle.overnightLocation
      );
    default:
      return false;
  }
}
