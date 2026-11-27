import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { findDemoPlate } from "#/features/quote/demo-plates";
import type { Actor } from "#/server/auth/actor";
import { getMyPolicy } from "#/server/data/policies";
import { getCatalogue } from "#/server/data/reference";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, jobs, policies, policyVersions, properties, vehicles } from "#/server/db/schema";
import {
  boughtCarPolicy,
  boughtHomePolicy,
  presetSubscription,
  resetPolicyWorld,
  setUpPolicyWorld,
} from "#/test/bought-policy";
import { fakeStripe } from "#/test/stripe-fake";

import { confirmMyPolicyChange, priceMyPolicyChange, type PriceChangeResult } from "./writes";

// Applying Change car and the home changes (6.3c, decisions 3, 5 to 7, 10 and 11): the rows
// updated in place, a snapshot v2 version, an audit row with no plate, name or address, and the
// email's lines. Monthly policies, so Confirm applies without a top-up.

const CHANGE_AT = new Date("2027-02-20T10:00:00Z");
const ctx = { headers: new Headers() };
const stripe = fakeStripe();
const deps = {
  now: CHANGE_AT,
  stripe,
  jobs: { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true },
};

beforeAll(() => setUpPolicyWorld());
beforeEach(async () => {
  await resetPolicyWorld();
  stripe.reset();
});
afterAll(closeDb);

async function price(actor: Actor, reference: string, change: unknown) {
  const result = await priceMyPolicyChange(actor, { input: { reference, change } }, ctx, deps);
  if (!result.ok) throw new Error(`price refused: ${result.error.message}`);
  return result.data;
}

async function confirm(actor: Actor, changeId: string) {
  const result = await confirmMyPolicyChange(
    actor,
    { input: { changeId }, idempotencyKey: randomUUID() },
    ctx,
    deps,
  );
  if (!result.ok) throw new Error(`confirm refused: ${result.error.message}`);
  return result.data;
}

function priced(result: PriceChangeResult) {
  if (result.status !== "priced") throw new Error(`not priced: ${JSON.stringify(result)}`);
  return result;
}

async function monthly(product: "car" | "home") {
  const bought =
    product === "car"
      ? await boughtCarPolicy({ plan: "monthly" })
      : await boughtHomePolicy({ plan: "monthly" });
  await presetSubscription(stripe, bought.policy.quoteId);
  return bought;
}

async function latest(policyId: string) {
  const rows = await getDb()
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policyId))
    .orderBy(policyVersions.version);
  return rows.at(-1)!;
}

async function auditOf(action: string) {
  const [entry] = await getDb().select().from(auditLog).where(eq(auditLog.action, action));
  return entry!;
}

async function emailParams() {
  const [job] = (await getDb().select().from(jobs)).filter(
    (j) => (j.payload as { template: string }).template === "policy_changed",
  );
  return (job!.payload as { params: Record<string, string> }).params;
}

async function propertyOf(quoteItemId: string) {
  const [row] = await getDb()
    .select()
    .from(properties)
    .where(eq(properties.quoteItemId, quoteItemId));
  return row!;
}

const SECURITY = {
  kind: "home_security",
  lockType: "multipoint",
  windowLocks: "all_accessible",
  alarmType: "none",
  hasSmokeAlarm: true,
} as const;

describe("change car", () => {
  it("changing car updates the vehicle row, keeps mileage use and parking, writes v2 with the new vehicle, audits make, model, year and group without the registration", async () => {
    const { actor, policy } = await monthly("car");
    const demo = findDemoPlate("TS24 EIV")!;
    const tesla = (await getCatalogue(getDb())).find(
      (r) => r.make === demo.make && r.model === demo.model && r.variant === demo.variant,
    )!;
    const [before] = await getDb()
      .select()
      .from(vehicles)
      .where(eq(vehicles.quoteItemId, policy.quoteItemId));
    const result = priced(
      await price(actor, policy.reference, {
        kind: "car_replaced",
        catalogueVariantId: tesla.id,
        registration: "ts24eiv",
        currentMileage: 9_000,
      }),
    );
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });

    const [after] = await getDb()
      .select()
      .from(vehicles)
      .where(eq(vehicles.quoteItemId, policy.quoteItemId));
    expect(after).toMatchObject({
      make: "Tesla",
      model: "Model 3",
      variant: tesla.variant,
      year: tesla.year,
      fuelType: tesla.fuelType,
      insuranceGroup: tesla.insuranceGroup,
      valuePence: tesla.valuePence,
      catalogueVariantId: tesla.id,
      registration: "TS24 EIV",
      currentMileage: 9_000,
      annualMileage: before!.annualMileage,
      usage: before!.usage,
      overnightLocation: before!.overnightLocation,
    });

    const version = await latest(policy.id);
    expect(version.version).toBe(2);
    expect(version.snapshot).toMatchObject({
      snapshotVersion: 2,
      vehicle: { make: "Tesla", model: "Model 3", catalogueVariantId: tesla.id },
    });
    expect(version.personal).toMatchObject({ registration: "TS24 EIV" });

    const entry = await auditOf("policy.car_changed");
    expect(entry.entityId).toBe(policy.id);
    expect(entry.changes).toEqual({
      make: { from: before!.make, to: "Tesla" },
      model: { from: before!.model, to: "Model 3" },
      year: { from: before!.year, to: tesla.year },
      insurance_group: { from: before!.insuranceGroup, to: tesla.insuranceGroup },
    });
    expect(JSON.stringify(entry.changes)).not.toMatch(/TS24|VW21/);

    expect(await emailParams()).toMatchObject({
      headline: "car changed",
      summary: `Your car is now a Tesla Model 3 (${tesla.year}).`,
    });
  });
});

describe("home changes", () => {
  it("updating contents writes the property, version and audit, and queues the email with the contents line", async () => {
    const { actor, policy } = await monthly("home");
    const result = priced(
      await price(actor, policy.reference, {
        kind: "home_contents",
        contentsValuePence: 6_000_000,
        valuablesPence: 900_000,
      }),
    );
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });
    expect(await propertyOf(policy.quoteItemId)).toMatchObject({
      contentsValuePence: 6_000_000,
      valuablesPence: 900_000,
    });
    expect((await latest(policy.id)).snapshot).toMatchObject({
      snapshotVersion: 2,
      property: { contentsValuePence: 6_000_000, valuablesPence: 900_000 },
    });
    expect((await auditOf("policy.contents_changed")).changes).toEqual({
      contents_value_pence: { from: 4_500_000, to: 6_000_000 },
      valuables_pence: { from: 500_000, to: 900_000 },
    });
    expect(await emailParams()).toMatchObject({
      headline: "contents updated",
      summary: "Your contents are now covered for £60,000, with valuables of £9,000.",
    });
  });

  it("updating security sets has_alarm from the alarm type and audits only the fields that moved", async () => {
    const { actor, policy } = await monthly("home");
    const result = priced(
      await price(actor, policy.reference, { ...SECURITY, alarmType: "monitored" }),
    );
    await confirm(actor, result.changeId);
    expect(await propertyOf(policy.quoteItemId)).toMatchObject({
      alarmType: "monitored",
      hasAlarm: true,
    });
    expect((await auditOf("policy.security_changed")).changes).toEqual({
      alarm_type: { from: "none", to: "monitored" },
    });
    expect(await emailParams()).toMatchObject({
      headline: "security updated",
      summary:
        "Your home's security details are updated. Burglar alarm: professionally installed and monitored.",
    });
  });

  it("a security change on a home with a null alarm_type requires an alarm type and records from: null", async () => {
    const { actor, policy } = await boughtHomePolicy({ plan: "monthly", rating: "v1" });
    await presetSubscription(stripe, policy.quoteId);
    expect(await propertyOf(policy.quoteItemId)).toMatchObject({
      alarmType: null,
      hasAlarm: false,
    });
    const missing = await priceMyPolicyChange(
      actor,
      { input: { reference: policy.reference, change: { ...SECURITY, alarmType: undefined } } },
      ctx,
      deps,
    );
    expect(missing.ok).toBe(false);

    // Only smoke alarms "changed" from the customer's view; the alarm answer is new
    const result = priced(
      await price(actor, policy.reference, { ...SECURITY, hasSmokeAlarm: false }),
    );
    await confirm(actor, result.changeId);
    expect(await propertyOf(policy.quoteItemId)).toMatchObject({
      alarmType: "none",
      hasAlarm: false,
      hasSmokeAlarm: false,
    });
    expect((await auditOf("policy.security_changed")).changes).toMatchObject({
      alarm_type: { from: null, to: "none" },
      window_locks: { from: null, to: "all_accessible" },
      has_smoke_alarm: { from: true, to: false },
    });
  });

  it("a valuables-only change is applied at the same price", async () => {
    const { actor, policy } = await monthly("home");
    const result = priced(
      await price(actor, policy.reference, {
        kind: "home_contents",
        contentsValuePence: 4_500_000,
        valuablesPence: 900_000,
      }),
    );
    expect(result).toMatchObject({ settlement: "none", priceLine: "Your price stays the same" });
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });
    const [row] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(row).toMatchObject({ version: 2, annualPremiumPence: policy.annualPremiumPence });
    expect(stripe.calls["subscriptions.update"]).toBeUndefined();
  });

  it("a home cover change updates the level and add-ons, leaving voluntary excess 0", async () => {
    const { actor, policy } = await monthly("home");
    const result = priced(
      await price(actor, policy.reference, {
        kind: "cover",
        coverLevel: "plus",
        addons: ["home_emergency"],
        voluntaryExcessPence: 0,
      }),
    );
    await confirm(actor, result.changeId);
    const [row] = await getDb().select().from(policies).where(eq(policies.id, policy.id));
    expect(row).toMatchObject({ coverLevel: "plus", voluntaryExcessPence: 0, version: 2 });
    expect((await latest(policy.id)).snapshot).toMatchObject({
      coverLevel: "plus",
      money: { addons: [{ addon: "home_emergency" }] },
    });
  });

  it("the page offers Make a change on an active home and its detail carries the security fields", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const detail = await getMyPolicy(actor, { reference: policy.reference });
    expect(detail.changes.eligible).toBe(true);
    expect(detail.home).toMatchObject({
      lockType: "multipoint",
      windowLocks: "all_accessible",
      alarmType: "none",
      hasSmokeAlarm: true,
    });
    const car = await boughtCarPolicy();
    const carDetail = await getMyPolicy(car.actor, { reference: car.policy.reference });
    expect(carDetail.car!.catalogueVariantId).toEqual(expect.any(String));
  });
});
