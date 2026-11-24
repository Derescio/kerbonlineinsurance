import { readFile } from "node:fs/promises";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { policies, policyVersions, quoteItemAddons, quotes } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import { makeCustomer, makeRatingVersion } from "#/test/factories";
import { makePurchase } from "#/test/purchase";

import { readSnapshot } from "#/server/data/policy-versions";

// 0027's version-1 backfill (6.3b, decision 9) builds in SQL what readSnapshot builds in code, for
// the policies bought before this slice. The two must agree exactly.

/** The backfill statement, between its markers in the migration */
async function backfillSql(): Promise<string> {
  const file = await readFile("drizzle/0027_policy_changes.sql", "utf8");
  const match = /-- backfill:start\n([\s\S]*?)-- backfill:end/.exec(file);
  if (!match) throw new Error("0027 has no backfill markers");
  return match[1]!.replace(/--> statement-breakpoint/g, "");
}

describe("policy_versions backfill (0027)", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  it("backfills version 1 for every policy, matching readSnapshot", async () => {
    const db = getDb();
    const version = await makeRatingVersion({ product: "car" });
    const annual = await makePurchase({
      customerId: (await makeCustomer()).id,
      ratingVersionId: version.id,
    });
    const monthly = await makePurchase({
      customerId: (await makeCustomer()).id,
      ratingVersionId: version.id,
      plan: "monthly",
    });
    // A policy with a multi-policy saving: its premium is below the tier and add-ons
    const saved = await makePurchase({
      customerId: (await makeCustomer()).id,
      ratingVersionId: version.id,
    });
    await db
      .update(quotes)
      .set({ bundleDiscountPence: 3_000, totalPence: saved.quote.totalPence - 3_000 })
      .where(eq(quotes.id, saved.quote.id));
    await db
      .update(policies)
      .set({ annualPremiumPence: 40_000 })
      .where(eq(policies.id, saved.policy.id));

    // One chosen add-on, so the add-on path is compared too
    await db
      .update(quoteItemAddons)
      .set({ selected: true })
      .where(eq(quoteItemAddons.quoteItemId, annual.policy.quoteItemId));

    // As before this slice: no versions at all
    await db.delete(policyVersions);
    await db.execute(sql.raw(await backfillSql()));
    // Run twice: a policy that already has version 1 is left alone
    await db.execute(sql.raw(await backfillSql()));

    for (const { policy } of [annual, monthly, saved]) {
      const rows = await db
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.policyId, policy.id));
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row!.version).toBe(1);
      expect(row!.policyChangeId).toBeNull();
      expect(row!.effectiveFrom).toEqual(policy.createdAt);
      const expected = await readSnapshot(db, policy.id, policy.createdAt);
      expect(row!.snapshot).toEqual(expected.snapshot);
      expect(row!.personal).toEqual(expected.personal);
    }
    const [{ money }] = [
      (
        await db.select().from(policyVersions).where(eq(policyVersions.policyId, saved.policy.id))
      )[0]!.snapshot as { money: { savingPence: number } },
    ];
    expect(money.savingPence).toBeGreaterThan(0);
  });
});
