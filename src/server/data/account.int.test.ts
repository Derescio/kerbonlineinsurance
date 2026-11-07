import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { OPEN_CLAIM_STATUSES } from "#/server/account/constants";
import { closeDb, getDb } from "#/server/db/client";
import { accountClosures, bundles } from "#/server/db/schema";
import { truncateAll } from "#/test/db";
import {
  makeClaim,
  makeCustomer,
  makePayment,
  makePolicy,
  makeQuote,
  makeUser,
} from "#/test/factories";

import { getAccountState, hasRecordsOnFile, openClaimReference, recordsOnFile } from "./account";

beforeEach(truncateAll);
afterAll(closeDb);

const day = 24 * 60 * 60 * 1000;

// closes_at must be exactly 30 days after requested_at
function window(requested: Date) {
  return { requestedAt: requested, closesAt: new Date(requested.getTime() + 30 * day) };
}

describe("getAccountState", () => {
  it("is active with no closure rows", async () => {
    const user = await makeUser();
    expect(await getAccountState(getDb(), user.id)).toEqual({ kind: "active" });
  });

  it("is closure_requested for an open row", async () => {
    const user = await makeUser();
    const { requestedAt, closesAt } = window(new Date());
    const [row] = await getDb()
      .insert(accountClosures)
      .values({ userId: user.id, requestedAt, closesAt })
      .returning();
    expect(await getAccountState(getDb(), user.id)).toEqual({
      kind: "closure_requested",
      closureId: row!.id,
      closesAt,
      heldSince: null,
    });
  });

  it("is active after a cancelled row", async () => {
    const user = await makeUser();
    await getDb()
      .insert(accountClosures)
      .values({ userId: user.id, ...window(new Date()), cancelledAt: new Date() });
    expect(await getAccountState(getDb(), user.id)).toEqual({ kind: "active" });
  });

  it("is closed for a closed row", async () => {
    const user = await makeUser();
    const closedAt = new Date();
    await getDb()
      .insert(accountClosures)
      .values({ userId: user.id, ...window(new Date(Date.now() - 31 * day)), closedAt });
    expect(await getAccountState(getDb(), user.id)).toEqual({ kind: "closed", closedAt });
  });
});

describe("recordsOnFile", () => {
  it("is empty for a user with no customer row", async () => {
    const user = await makeUser();
    const r = await recordsOnFile(getDb(), user.id);
    expect(r).toEqual({ policies: [], claims: [], hasPayments: false, hasBundles: false });
    expect(hasRecordsOnFile(r)).toBe(false);
    expect(await openClaimReference(getDb(), user.id)).toBeNull();
  });

  it("does not count a quote alone", async () => {
    const customer = await makeCustomer();
    await makeQuote({ customerId: customer.id });
    expect(hasRecordsOnFile(await recordsOnFile(getDb(), customer.userId))).toBe(false);
  });

  it.each(["active", "cancelled", "lapsed"] as const)("counts a %s policy", async (status) => {
    const customer = await makeCustomer();
    const policy = await makePolicy({
      customerId: customer.id,
      status,
      ...(status === "cancelled" ? { cancelledAt: new Date() } : {}),
    });
    const r = await recordsOnFile(getDb(), customer.userId);
    expect(r.policies).toEqual([{ id: policy.id, product: "car", status }]);
    expect(hasRecordsOnFile(r)).toBe(true);
  });

  it("counts a refunded payment on an unbought quote", async () => {
    const customer = await makeCustomer();
    await makePayment({ customerId: customer.id, status: "refunded" });
    const r = await recordsOnFile(getDb(), customer.userId);
    expect(r.hasPayments).toBe(true);
    expect(r.policies).toEqual([]);
    expect(hasRecordsOnFile(r)).toBe(true);
  });

  it("counts a bundle", async () => {
    const customer = await makeCustomer();
    const { quote } = await makeQuote({ customerId: customer.id });
    await getDb().insert(bundles).values({ customerId: customer.id, quoteId: quote.id });
    const r = await recordsOnFile(getDb(), customer.userId);
    expect(r.hasBundles).toBe(true);
    expect(hasRecordsOnFile(r)).toBe(true);
  });

  it("lists claims with open from OPEN_CLAIM_STATUSES, and leaves drafts out", async () => {
    const customer = await makeCustomer();
    const policy = await makePolicy({ customerId: customer.id });
    const refs: Record<string, string> = {};
    for (const status of ["draft", ...OPEN_CLAIM_STATUSES, "settled", "declined"] as const) {
      refs[status] = (
        await makeClaim({ policyId: policy.id, customerId: customer.id, status })
      ).reference;
    }
    const r = await recordsOnFile(getDb(), customer.userId);
    expect(r.claims.map((c) => c.reference)).not.toContain(refs.draft);
    const byRef = new Map(r.claims.map((c) => [c.reference, c.open]));
    for (const status of OPEN_CLAIM_STATUSES) expect(byRef.get(refs[status]!)).toBe(true);
    expect(byRef.get(refs.settled!)).toBe(false);
    expect(byRef.get(refs.declined!)).toBe(false);
    expect(await openClaimReference(getDb(), customer.userId)).toBe(refs.received);
  });
});
