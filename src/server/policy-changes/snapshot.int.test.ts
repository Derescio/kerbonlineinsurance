import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { latestVersion, readSnapshot } from "#/server/data/policy-version-rows";
import { closeDb, getDb } from "#/server/db/client";
import { customers, policyVersions, properties } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makeRatingVersion } from "#/test/factories";
import { makePurchase } from "#/test/purchase";

// Snapshot version 2 (6.3c, decision 10): the car and the home are recorded, a plate only in
// `personal`, and a home's place is the insured home's, not where the customer lives.

describe("policy_versions snapshot v2", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("a car snapshot is v2 with the vehicle and the registration only in personal", async () => {
    const { policy } = await makePurchase({
      customerId: (await makeCustomer()).id,
      ratingVersionId: (await makeRatingVersion({ product: "car" })).id,
    });
    const { snapshot, personal } = await readSnapshot(getDb(), policy.id, new Date());
    expect(snapshot.snapshotVersion).toBe(2);
    expect(snapshot).toMatchObject({
      vehicle: {
        make: "Volkswagen",
        model: "Golf",
        year: 2019,
        variant: "1.5 TSI Life",
        insuranceGroup: 17,
        valuePence: 1_400_000,
        catalogueVariantId: null,
      },
      property: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("AB19");
    expect(personal.registration).toBe("AB19 CDE");
  });

  it("a home snapshot is v2 with the property, and its district and personal address are the insured home's", async () => {
    const customer = await makeCustomer({ postcode: "M1 1AE", addressLine1: "9 Elsewhere Road" });
    const { policy } = await makePurchase({
      customerId: customer.id,
      ratingVersionId: (await makeRatingVersion({ product: "home" })).id,
      product: "home",
    });
    await getDb()
      .update(properties)
      .set({ valuablesPence: 600_000, windowLocks: "some", alarmType: "monitored" })
      .where(eq(properties.quoteItemId, policy.quoteItemId));
    const { snapshot, personal } = await readSnapshot(getDb(), policy.id, new Date());
    expect(snapshot).toMatchObject({
      snapshotVersion: 2,
      vehicle: null,
      property: {
        propertyType: "terraced",
        contentsValuePence: 4_000_000,
        valuablesPence: 600_000,
        lockType: "five_lever",
        windowLocks: "some",
        alarmType: "monitored",
        hasSmokeAlarm: true,
      },
      postcodeDistrict: "SW1A",
      drivers: [],
    });
    expect(personal.address).toEqual({
      line1: "1 Test Street",
      line2: null,
      town: "London",
      postcode: "SW1A 1AA",
    });
    expect(personal.registration).toBeNull();
    const [row] = await getDb().select().from(customers).where(eq(customers.id, customer.id));
    expect(row!.postcodeDistrict).toBe("M1");
  });

  it("latestVersion reads a v1 row's money unchanged", async () => {
    const { policy } = await makePurchase({
      customerId: (await makeCustomer()).id,
      ratingVersionId: (await makeRatingVersion({ product: "car" })).id,
    });
    const money = {
      tierPence: 40_000,
      addons: [],
      savingPence: 0,
      quoteTotalPence: 45_000,
      instalmentPence: null,
    };
    // The policy's version 1, as 0027's backfill wrote it before snapshot v2
    await getDb().delete(policyVersions).where(eq(policyVersions.policyId, policy.id));
    await getDb()
      .insert(policyVersions)
      .values({
        policyId: policy.id,
        version: 1,
        effectiveFrom: new Date(),
        snapshot: { snapshotVersion: 1, money },
        personal: {},
      });
    const latest = await latestVersion(getDb(), policy.id);
    expect(latest.version).toBe(1);
    expect(latest.snapshot.snapshotVersion).toBe(1);
    expect(latest.snapshot.money).toEqual(money);
  });
});
