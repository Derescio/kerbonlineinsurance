import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CANT_CHANGE_ONLINE } from "#/features/policy-changes/copy";
import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { findDemoPlate } from "#/features/quote/demo-plates";
import type { Actor } from "#/server/auth/actor";
import { loadPolicyForChange } from "#/server/data/policy-change-rows";
import { getCatalogue, getRatingTables, type RatingTables } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { policyChanges, vehicleCatalogue, vehicles } from "#/server/db/schema";
import { withTx } from "#/server/db/tx";
import { boughtCarPolicy, resetPolicyWorld, setUpPolicyWorld } from "#/test/bought-policy";
import { getOwnerDb } from "#/test/db";
import { fakeStripe } from "#/test/stripe-fake";

import { priceChange } from "./price";
import { resolveChange } from "./resolve";
import { priceMyPolicyChange } from "./writes";

// Change car (6.3c, decision 3): the new car comes from the catalogue row the request names,
// checked against its demo plate, and is priced on the policy's own rating version.

const CHANGE_AT = new Date("2027-02-20T10:00:00Z");
const TODAY = "2027-02-20";
const ctx = { headers: new Headers() };
const deps = {
  now: CHANGE_AT,
  stripe: fakeStripe(),
  jobs: { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true },
};

beforeAll(() => setUpPolicyWorld());
beforeEach(resetPolicyWorld);
afterAll(closeDb);

/** The catalogue row a demo plate points at */
async function rowForPlate(plate: string) {
  const demo = findDemoPlate(plate)!;
  return (await getCatalogue(getDb())).find(
    (r) =>
      r.make === demo.make &&
      r.model === demo.model &&
      r.year === demo.year &&
      r.variant === demo.variant,
  )!;
}

function newCar(
  catalogueVariantId: string,
  registration: string | null,
): Extract<PolicyChangeRequest, { kind: "car_replaced" }> {
  return { kind: "car_replaced", catalogueVariantId, registration, currentMileage: 9_000 };
}

async function price(actor: Actor, reference: string, change: unknown) {
  const result = await priceMyPolicyChange(actor, { input: { reference, change } }, ctx, deps);
  if (!result.ok) throw new Error(`price refused: ${result.error.message}`);
  return result.data;
}

/** A catalogue row the tests add: Kerb's catalogue has no car this high. Reference rows survive
 * the reset between tests, so it's made once and made active again */
async function groupFortySix() {
  const [existing] = await getOwnerDb()
    .update(vehicleCatalogue)
    .set({ isActive: true })
    .where(eq(vehicleCatalogue.variant, "Group 46 test car"))
    .returning();
  if (existing) return existing;
  const [row] = await getOwnerDb()
    .insert(vehicleCatalogue)
    .values({
      make: "Testmobile",
      model: "Rocket",
      year: 2022,
      variant: "Group 46 test car",
      bodyStyle: "hatchback",
      fuelType: "petrol",
      transmission: "manual",
      doors: 3,
      engineCc: 1998,
      powerBhp: 300,
      insuranceGroup: 46,
      valuePence: 3_000_000,
    })
    .returning();
  return row!;
}

describe("resolving the new car", () => {
  it("a demo plate in any case and spacing resolves to its catalogue row", async () => {
    const tesla = await rowForPlate("TS24 EIV");
    for (const typed of ["TS24EIV", "ts24eiv"]) {
      const resolved = await withTx(getDb(), (tx) => resolveChange(tx, newCar(tesla.id, typed)));
      expect(resolved).toMatchObject({
        kind: "car_replaced",
        car: {
          id: tesla.id,
          make: "Tesla",
          model: "Model 3",
          insuranceGroup: tesla.insuranceGroup,
        },
      });
    }
  });

  it("a demo plate sent with another variant's id is refused", async () => {
    const tesla = await rowForPlate("TS24 EIV");
    const resolved = await withTx(getDb(), (tx) => resolveChange(tx, newCar(tesla.id, "FD69KQB")));
    expect(resolved).toEqual({ refused: CANT_CHANGE_ONLINE });
  });

  it("an unknown registration is refused; a manual choice with registration null resolves", async () => {
    const tesla = await rowForPlate("TS24 EIV");
    expect(await withTx(getDb(), (tx) => resolveChange(tx, newCar(tesla.id, "AB12CDE")))).toEqual({
      refused: CANT_CHANGE_ONLINE,
    });
    expect(await withTx(getDb(), (tx) => resolveChange(tx, newCar(tesla.id, null)))).toMatchObject({
      car: { id: tesla.id },
    });
  });

  it("an inactive catalogue row is refused", async () => {
    const rocket = await groupFortySix();
    await getOwnerDb()
      .update(vehicleCatalogue)
      .set({ isActive: false })
      .where(eq(vehicleCatalogue.id, rocket.id));
    expect(await withTx(getDb(), (tx) => resolveChange(tx, newCar(rocket.id, null)))).toEqual({
      refused: CANT_CHANGE_ONLINE,
    });
  });
});

describe("pricing the new car", () => {
  it("the new car's group and value come from the catalogue, not the request", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const tesla = await rowForPlate("TS24 EIV");
    // Extra fields a browser might send are dropped by the schema; only the id names the car
    const result = await price(actor, policy.reference, {
      ...newCar(tesla.id, "TS24 EIV"),
      insuranceGroup: 1,
      valuePence: 100,
    });
    expect(result.status).toBe("priced");
    const [row] = await getDb()
      .select()
      .from(policyChanges)
      .where(eq(policyChanges.policyId, policy.id));
    expect(row!.request).not.toHaveProperty("insuranceGroup");
    expect(row!.priceAfterPence).not.toBe(row!.priceBeforePence);
  });

  it("a new car at refer_insurance_group_min is referred, and nothing is written", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const rocket = await groupFortySix();
    expect(await price(actor, policy.reference, newCar(rocket.id, null))).toEqual({
      status: "refused",
      message: CANT_CHANGE_ONLINE,
    });
    const [vehicle] = await getDb()
      .select()
      .from(vehicles)
      .where(eq(vehicles.quoteItemId, policy.quoteItemId));
    expect(vehicle!.model).toBe("Golf");
  });

  it("a new car the bought rating version has no band for is referred, not thrown", async () => {
    const { policy } = await boughtCarPolicy();
    const tesla = await rowForPlate("TS24 EIV");
    await withTx(getDb(), async (tx) => {
      const stored = (await loadPolicyForChange(tx, policy.id))!;
      const tables = await getRatingTables(tx, stored.ratingVersionId);
      // As if the policy's version priced no electric cars
      const noElectric: RatingTables = {
        ...tables,
        factors: tables.factors.filter((f) => !(f.factor === "fuel_type" && f.band === "electric")),
      };
      const resolved = await resolveChange(tx, newCar(tesla.id, "TS24 EIV"));
      if ("refused" in resolved) throw new Error("not resolved");
      expect(priceChange(stored, resolved, noElectric, TODAY)).toEqual({
        outcome: "referred",
        reasonCode: null,
      });
    });
  });

  it("the policy's own variant is unchanged, whatever the plate or mileage", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const [vehicle] = await getDb()
      .select()
      .from(vehicles)
      .where(eq(vehicles.quoteItemId, policy.quoteItemId));
    const result = await price(actor, policy.reference, {
      ...newCar(vehicle!.catalogueVariantId!, null),
      currentMileage: 30_000,
    });
    expect(result).toEqual({ status: "unchanged", levels: [], addons: [] });
  });
});
