import { CANT_CHANGE_ONLINE } from "#/features/policy-changes/copy";
import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { findDemoPlate } from "#/features/quote/demo-plates";
import { catalogueCar, type CatalogueCar } from "#/server/data/policy-change-rows";
import type { Tx } from "#/server/db/tx";

// Change car's new car, from the server's own catalogue (6.3c, decision 3). The browser names a
// catalogue row; every car detail that's priced or stored is read here, never taken from it. A
// plate must be the demo plate for that row. Kerbie (7.5) has no browser: it sends the plate's row
// through the same check.

type CarReplaced = Extract<PolicyChangeRequest, { kind: "car_replaced" }>;

/** A change as it's priced and applied: a change of car carries its catalogue row */
export type ResolvedChange =
  | Exclude<PolicyChangeRequest, { kind: "car_replaced" }>
  | (CarReplaced & { car: CatalogueCar });

/** The catalogue row a demo plate points at, or null for a plate the demo doesn't know */
export async function carForPlate(tx: Tx, registration: string): Promise<CatalogueCar | null> {
  const demo = findDemoPlate(registration);
  if (!demo) return null;
  return catalogueCar(tx, {
    make: demo.make,
    model: demo.model,
    year: demo.year,
    variant: demo.variant,
  });
}

export async function resolveChange(
  tx: Tx,
  change: PolicyChangeRequest,
): Promise<ResolvedChange | { refused: string }> {
  if (change.kind !== "car_replaced") return change;
  const car = await catalogueCar(tx, { id: change.catalogueVariantId });
  if (!car) return { refused: CANT_CHANGE_ONLINE };
  if (change.registration !== null) {
    const plated = await carForPlate(tx, change.registration);
    if (plated?.id !== car.id) return { refused: CANT_CHANGE_ONLINE };
  }
  return { ...change, car };
}
