import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CANT_CHANGE_ONLINE } from "#/features/policy-changes/copy";
import { closeDb } from "#/server/db/client";
import type { Actor } from "#/server/auth/actor";
import {
  boughtCarPolicy,
  boughtHomePolicy,
  resetPolicyWorld,
  setUpPolicyWorld,
} from "#/test/bought-policy";
import { fakeStripe } from "#/test/stripe-fake";

import { priceMyPolicyChange } from "./writes";

// Pricing a change to a home policy (6.3c, decisions 2, 4 to 7). Bought on 11 Nov 2026, changed on
// 20 Feb 2027, re-priced on the home rating version it was bought on.

const CHANGE_AT = new Date("2027-02-20T10:00:00Z");
const ctx = { headers: new Headers() };
const deps = {
  now: CHANGE_AT,
  stripe: fakeStripe(),
  jobs: { sendEmail: vi.fn(), defer: () => undefined, holdEmails: true },
};

beforeAll(() => setUpPolicyWorld());
beforeEach(resetPolicyWorld);
afterAll(closeDb);

async function price(actor: Actor, reference: string, change: unknown) {
  const result = await priceMyPolicyChange(actor, { input: { reference, change } }, ctx, deps);
  if (!result.ok) throw new Error(`price refused: ${result.error.message}`);
  return result.data;
}

const SECURITY = {
  kind: "home_security",
  lockType: "multipoint",
  windowLocks: "all_accessible",
  alarmType: "none",
  hasSmokeAlarm: true,
} as const;

describe("pricing a home policy change", () => {
  it("a home cover change prices on the bought rating version with home's add-ons", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const result = await price(actor, policy.reference, {
      kind: "cover",
      coverLevel: "plus",
      addons: ["home_emergency"],
      voluntaryExcessPence: 0,
    });
    expect(result.status).toBe("priced");
    if (result.status !== "priced") return;
    expect(result.priceLine).toMatch(/^You'll pay £[\d.,]+ now for the rest of the year$/);
    expect(result.addons.map((a) => a.addon).sort()).toEqual([
      "home_emergency",
      "legal_expenses",
      "personal_possessions",
    ]);
    expect(result.levels.map((l) => l.coverLevel)).toEqual(["essential", "comprehensive", "plus"]);
  });

  it("a contents value at refer_contents_pence_min is referred", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const result = await price(actor, policy.reference, {
      kind: "home_contents",
      contentsValuePence: 15_000_000,
      valuablesPence: 500_000,
    });
    expect(result).toEqual({ status: "refused", message: CANT_CHANGE_ONLINE });
  });

  it("a valuables-only change prices 'Your price stays the same'", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const result = await price(actor, policy.reference, {
      kind: "home_contents",
      contentsValuePence: 4_500_000,
      valuablesPence: 900_000,
    });
    expect(result).toMatchObject({ status: "priced", priceLine: "Your price stays the same" });
  });

  it("a home bought on home v1 with no occupation prices without throwing", async () => {
    const { actor, policy } = await boughtHomePolicy({ rating: "v1" });
    const result = await price(actor, policy.reference, {
      kind: "home_contents",
      contentsValuePence: 6_000_000,
      valuablesPence: 0,
    });
    expect(result.status).toBe("priced");
  });

  it("a security change that fits the alarm prices; the alarm moving moves the price", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const same = await price(actor, policy.reference, { ...SECURITY, windowLocks: "some" });
    expect(same).toMatchObject({ status: "priced", priceLine: "Your price stays the same" });
    const alarmed = await price(actor, policy.reference, { ...SECURITY, alarmType: "monitored" });
    expect(alarmed).toMatchObject({ status: "priced", settlement: "refund" });
  });

  it("a home cover change with a voluntary excess is refused", async () => {
    const { actor, policy } = await boughtHomePolicy();
    const result = await price(actor, policy.reference, {
      kind: "cover",
      coverLevel: "comprehensive",
      addons: [],
      voluntaryExcessPence: 25_000,
    });
    expect(result).toEqual({ status: "refused", message: CANT_CHANGE_ONLINE });
  });

  it("a car kind on a home policy, and a home kind on a car policy, are refused", async () => {
    const home = await boughtHomePolicy();
    expect(
      await price(home.actor, home.policy.reference, {
        kind: "address",
        postcode: "LS6 2AB",
        addressLine1: "18 Albion Road",
        addressLine2: null,
        town: "Leeds",
        overnightLocation: "street",
      }),
    ).toEqual({ status: "refused", message: CANT_CHANGE_ONLINE });
    const car = await boughtCarPolicy();
    expect(await price(car.actor, car.policy.reference, SECURITY)).toEqual({
      status: "refused",
      message: CANT_CHANGE_ONLINE,
    });
  });
});
