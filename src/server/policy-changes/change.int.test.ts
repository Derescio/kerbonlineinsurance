import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { closeDb, getDb } from "#/server/db/client";
import {
  auditLog,
  customers,
  drivers,
  payments,
  policies,
  policyChanges,
  policyVersions,
  properties,
  quotes,
  vehicles,
} from "#/server/db/schema";
import { carV1 } from "#/server/reference/rating/car-v1";
import { boughtCarPolicy, resetPolicyWorld, setUpPolicyWorld } from "#/test/bought-policy";
import { makeCustomer, makePolicy, makeUser } from "#/test/factories";
import { fakeStripe } from "#/test/stripe-fake";
import { resolveActor, type Actor } from "#/server/auth/actor";

import { confirmMyPolicyChange, priceMyPolicyChange, type PriceChangeResult } from "./writes";

// Pricing and applying a change to a car policy (6.3b, decisions 2, 4, 6 to 9, 11 to 13). The
// policy is bought on car v1 on 11 Nov 2026; a car v2 that prices everything higher is active by
// the change on 20 Feb 2027, before either driver's birthday, so an unchanged policy re-prices to
// exactly what it was sold for. Settling in Stripe is Task 5's (settle.int.test.ts).

const CHANGE_AT = new Date("2027-02-20T10:00:00Z");
const ctx = { headers: new Headers() };
const deps = { now: CHANGE_AT, stripe: fakeStripe() };

const carV2 = {
  ...carV1,
  version: 2,
  effectiveFrom: "2027-01-01",
  notes: "A test version that prices everything higher",
  parameters: { ...carV1.parameters, base_rate_pence: 92_000 },
};

const SAME_COVER: PolicyChangeRequest = {
  kind: "cover",
  coverLevel: "comprehensive",
  addons: [],
  voluntaryExcessPence: 0,
};

const ARJUN = {
  firstName: "Arjun",
  lastName: "Patel",
  dateOfBirth: "1989-11-02",
  relationship: "partner",
  status: "employed",
  occupation: "teacher",
  licenceType: "full_uk",
  licenceDate: "2015-06-01",
  noClaimsConfirmed: true,
};

beforeAll(() => setUpPolicyWorld([carV2]));
beforeEach(resetPolicyWorld);
afterAll(closeDb);

async function price(actor: Actor, reference: string, change: unknown) {
  const result = await priceMyPolicyChange(actor, { input: { reference, change } }, ctx, deps);
  if (!result.ok) throw new Error(`price refused: ${result.error.message}`);
  return result.data;
}

async function confirm(actor: Actor, changeId: string, idempotencyKey: string = randomUUID()) {
  const result = await confirmMyPolicyChange(
    actor,
    { input: { changeId }, idempotencyKey },
    ctx,
    deps,
  );
  if (!result.ok) throw new Error(`confirm refused: ${result.error.message}`);
  return result.data;
}

function priced(result: PriceChangeResult) {
  if (result.status !== "priced") throw new Error(`not priced: ${result.message}`);
  return result;
}

async function versionsOf(policyId: string) {
  return getDb()
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policyId))
    .orderBy(policyVersions.version);
}

async function policyRow(id: string) {
  const [row] = await getDb().select().from(policies).where(eq(policies.id, id));
  return row!;
}

describe("re-pricing", () => {
  it("re-prices an unchanged policy to what it was sold for, on its own rating version", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const result = priced(await price(actor, policy.reference, SAME_COVER));
    const [change] = await getDb()
      .select()
      .from(policyChanges)
      .where(eq(policyChanges.id, result.changeId));
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, policy.quoteId));
    expect(change!.priceBeforePence).toBe(quote!.totalPence);
    expect(change!.priceAfterPence).toBe(quote!.totalPence);
    expect(change!.newAnnualPence).toBe(policy.annualPremiumPence);
    expect(result.priceLine).toBe("Your price stays the same");
    expect(change!.status).toBe("priced");
  });

  it("lists each cover level's price line for a cover change", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = priced(await price(actor, policy.reference, SAME_COVER));
    expect(result.levels.map((l) => l.coverLevel)).toEqual(["essential", "comprehensive", "plus"]);
    expect(result.levels.find((l) => l.coverLevel === "comprehensive")!.priceLine).toBe(
      "Your price stays the same",
    );
    expect(result.levels.find((l) => l.coverLevel === "plus")!.priceLine).toMatch(
      /^Your price goes up by £\d+\.\d\d a month$/,
    );
    expect(result.addons.map((a) => a.addon)).toContain("breakdown_uk");
  });
});

describe("applying a change", () => {
  it("adds a driver: the row, version 2, the version bumped and an audit row without the name", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = priced(
      await price(actor, policy.reference, { kind: "driver_added", driver: ARJUN }),
    );
    // An adult driver with a long licence may not move the price on car v1
    expect(result.priceLine).toMatch(
      /^Your price (goes (up|down) by £\d+\.\d\d a month|stays the same)$/,
    );
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });

    const rows = await getDb()
      .select()
      .from(drivers)
      .where(eq(drivers.quoteItemId, policy.quoteItemId));
    expect(rows.map((d) => d.firstName).sort()).toEqual(["Alex", "Arjun", "Jamie"]);
    const arjun = rows.find((d) => d.firstName === "Arjun")!;
    expect(arjun).toMatchObject({ isMain: false, relationship: "partner", pastClaims: 0 });

    expect((await policyRow(policy.id)).version).toBe(2);
    const versions = await versionsOf(policy.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[1]!.policyChangeId).toBe(result.changeId);
    const personal = versions[1]!.personal as { drivers: { firstName: string }[] };
    expect(personal.drivers.map((d) => d.firstName)).toContain("Arjun");

    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "policy.driver_added"));
    expect(entry!.entityId).toBe(policy.id);
    expect(JSON.stringify(entry!.changes)).not.toContain("Arjun");
    expect(entry!.changes).toMatchObject({ relationship: "partner", licence_years: 11 });

    const [change] = await getDb()
      .select()
      .from(policyChanges)
      .where(eq(policyChanges.id, result.changeId));
    expect(change).toMatchObject({ status: "applied", toVersion: 2 });
  });

  it("removes a named driver; version 2's personal part still names them", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const [jamie] = await getDb()
      .select()
      .from(drivers)
      .where(and(eq(drivers.quoteItemId, policy.quoteItemId), eq(drivers.firstName, "Jamie")));
    const result = priced(
      await price(actor, policy.reference, { kind: "driver_removed", driverId: jamie!.id }),
    );
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });
    const left = await getDb()
      .select()
      .from(drivers)
      .where(eq(drivers.quoteItemId, policy.quoteItemId));
    expect(left.map((d) => d.firstName)).toEqual(["Alex"]);
    const [v1] = await versionsOf(policy.id);
    expect((v1!.personal as { drivers: { firstName: string }[] }).drivers).toHaveLength(2);
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "policy.driver_removed"));
    expect(entry!.changes).toEqual({ relationship: "spouse" });
  });

  it("changes the address: the customer, the quote's postcode and where the car is parked", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = priced(
      await price(actor, policy.reference, {
        kind: "address",
        postcode: "n16 7hb",
        addressLine1: "12 Albion Road",
        addressLine2: null,
        town: "London",
        overnightLocation: "street",
      }),
    );
    expect(result.homeWarning).toBeNull();
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });
    const [customer] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, policy.customerId));
    expect(customer).toMatchObject({ addressLine1: "12 Albion Road", postcode: "N16 7HB" });
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, policy.quoteId));
    expect(quote!.postcode).toBe("N16 7HB");
    const [vehicle] = await getDb()
      .select()
      .from(vehicles)
      .where(eq(vehicles.quoteItemId, policy.quoteItemId));
    expect(vehicle!.overnightLocation).toBe("street");
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "policy.address_changed"));
    expect(entry!.changes).toEqual({
      postcode_area: { from: "E", to: "N" },
      overnight_location: { from: "driveway", to: "street" },
    });
    expect(JSON.stringify(entry!.changes)).not.toContain("Albion");
  });

  it("changes cover: the level, the excesses and the premium, and the version's money adds up", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = priced(
      await price(actor, policy.reference, {
        kind: "cover",
        coverLevel: "plus",
        addons: ["breakdown_uk"],
        voluntaryExcessPence: 50_000,
      }),
    );
    expect(await confirm(actor, result.changeId)).toEqual({ status: "applied" });
    const after = await policyRow(policy.id);
    const [change] = await getDb()
      .select()
      .from(policyChanges)
      .where(eq(policyChanges.id, result.changeId));
    expect(after).toMatchObject({
      coverLevel: "plus",
      voluntaryExcessPence: 50_000,
      annualPremiumPence: change!.newAnnualPence,
      version: 2,
    });
    const [, v2] = await versionsOf(policy.id);
    const { money } = v2!.snapshot as {
      money: { tierPence: number; addons: { annualPricePence: number }[]; savingPence: number };
    };
    expect(money.addons).toHaveLength(1);
    expect(money.tierPence + money.addons[0]!.annualPricePence - money.savingPence).toBe(
      after.annualPremiumPence,
    );
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "policy.cover_changed"));
    expect(entry!.changes).toEqual({
      cover_level: { from: "comprehensive", to: "plus" },
      addons: { added: ["breakdown_uk"], removed: [] },
      voluntary_excess_pence: { from: 0, to: 50_000 },
    });
  });

  it("confirms once for one idempotency key", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = priced(
      await price(actor, policy.reference, { kind: "driver_added", driver: ARJUN }),
    );
    const key = randomUUID();
    expect(await confirm(actor, result.changeId, key)).toEqual({ status: "applied" });
    expect(await confirm(actor, result.changeId, key)).toEqual({ status: "applied" });
    expect(await versionsOf(policy.id)).toHaveLength(2);
  });

  it("refuses a confirm priced against an older version, with the new price line", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const first = priced(await price(actor, policy.reference, SAME_COVER));
    const second = priced(
      await price(actor, policy.reference, { kind: "driver_added", driver: ARJUN }),
    );
    expect(await confirm(actor, second.changeId)).toEqual({ status: "applied" });
    const stale = await confirm(actor, first.changeId);
    expect(stale).toMatchObject({ status: "refused", message: "The price has changed" });
    expect((await versionsOf(policy.id)).map((v) => v.version)).toEqual([1, 2]);
  });
});

describe("what isn't changed online", () => {
  const REFUSED = { status: "refused", message: "We can't make this change online." };

  it("records a refused change and changes nothing when the change would be referred", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const result = await price(actor, policy.reference, {
      kind: "driver_added",
      driver: { ...ARJUN, dateOfBirth: "1940-01-01", licenceDate: "1960-01-01" },
    });
    expect(result).toMatchObject(REFUSED);
    const [change] = await getDb().select().from(policyChanges);
    expect(change).toMatchObject({ outcome: "referred", status: "refused" });
    expect(await versionsOf(policy.id)).toHaveLength(1);
  });

  it("refuses a policy that would now be referred as it stands", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    await getDb()
      .update(drivers)
      .set({ dateOfBirth: "1940-01-01" })
      .where(and(eq(drivers.quoteItemId, policy.quoteItemId), eq(drivers.isMain, true)));
    expect(await price(actor, policy.reference, SAME_COVER)).toMatchObject(REFUSED);
  });

  it("treats another customer's policy as not found", async () => {
    const { policy } = await boughtCarPolicy();
    const user = await makeUser();
    await makeCustomer({ userId: user.id });
    const stranger = (await resolveActor(getDb(), user.id))!;
    await expect(
      priceMyPolicyChange(
        stranger,
        { input: { reference: policy.reference, change: SAME_COVER } },
        ctx,
        deps,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a home policy", async () => {
    const { actor } = await boughtCarPolicy();
    const home = await makePolicy({ customerId: actor.customerId!, product: "home" });
    expect(await price(actor, home.reference, SAME_COVER)).toMatchObject(REFUSED);
  });

  it("refuses a lapsed, a cancelled and an ended policy", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    const db = getDb();
    await db
      .update(policies)
      .set({ status: "lapsed", lapsedAt: CHANGE_AT })
      .where(eq(policies.id, policy.id));
    expect(await price(actor, policy.reference, SAME_COVER)).toMatchObject(REFUSED);
    await db
      .update(policies)
      .set({ status: "cancelled", lapsedAt: null, cancelledAt: CHANGE_AT })
      .where(eq(policies.id, policy.id));
    expect(await price(actor, policy.reference, SAME_COVER)).toMatchObject(REFUSED);
    await db
      .update(policies)
      .set({ status: "active", cancelledAt: null, endsOn: "2027-02-20" })
      .where(eq(policies.id, policy.id));
    expect(await price(actor, policy.reference, SAME_COVER)).toMatchObject(REFUSED);
  });

  it("refuses a monthly policy with a failed instalment", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    await getDb()
      .update(payments)
      .set({ status: "failed" })
      .where(and(eq(payments.quoteId, policy.quoteId), eq(payments.instalmentNumber, 3)));
    expect(await price(actor, policy.reference, SAME_COVER)).toMatchObject(REFUSED);
  });

  it("refuses an address change when the customer holds another active car policy", async () => {
    const { actor, policy } = await boughtCarPolicy();
    await makePolicy({
      customerId: actor.customerId!,
      startsOn: "2026-12-01",
      endsOn: "2027-11-30",
    });
    const result = await price(actor, policy.reference, {
      kind: "address",
      postcode: "N16 7HB",
      addressLine1: "12 Albion Road",
      addressLine2: null,
      town: "London",
      overnightLocation: "street",
    });
    expect(result).toMatchObject(REFUSED);
  });

  it("warns that a home policy keeps its own address", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const home = await makePolicy({
      customerId: actor.customerId!,
      product: "home",
      startsOn: "2026-12-01",
      endsOn: "2027-11-30",
    });
    const [property] = await getDb()
      .select()
      .from(properties)
      .where(eq(properties.quoteItemId, home.quoteItemId));
    const result = priced(
      await price(actor, policy.reference, {
        kind: "address",
        postcode: "N16 7HB",
        addressLine1: "12 Albion Road",
        addressLine2: null,
        town: "London",
        overnightLocation: "street",
      }),
    );
    expect(result.homeWarning).toBe(
      `Your home insurance isn't changed. It still covers ${property!.addressLine1}.`,
    );
  });

  it("refuses a fifth named driver", async () => {
    const { actor, policy } = await boughtCarPolicy({ plan: "monthly" });
    for (const name of ["Ann", "Ben", "Cat"]) {
      await getDb().insert(drivers).values({
        quoteItemId: policy.quoteItemId,
        firstName: name,
        lastName: "Morgan",
        dateOfBirth: "1990-01-01",
        occupation: "teacher",
        licenceYears: 10,
        noClaimsYears: 0,
        relationship: "sibling",
      });
    }
    expect(
      await price(actor, policy.reference, { kind: "driver_added", driver: ARJUN }),
    ).toMatchObject(REFUSED);
  });

  it("refuses a driver whose claims box isn't ticked, before pricing", async () => {
    const { actor, policy } = await boughtCarPolicy();
    const result = await priceMyPolicyChange(
      actor,
      {
        input: {
          reference: policy.reference,
          change: { kind: "driver_added", driver: { ...ARJUN, noClaimsConfirmed: false } },
        },
      },
      ctx,
      deps,
    );
    expect(result.ok).toBe(false);
    expect(await getDb().select().from(policyChanges)).toHaveLength(0);
  });
});
