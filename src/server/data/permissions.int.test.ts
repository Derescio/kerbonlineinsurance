import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Actor } from "#/server/auth/actor";
import { AuthzError, type AuthzCode } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { parseKeys } from "#/server/audit/chain";
import { verifyAuditChain } from "#/server/audit/verify";
import { auditLog, quoteItems, underwritingDecisions } from "#/server/db/schema";
import { getOwnerDb, truncateAll } from "#/test/db";
import { makeQuote } from "#/test/factories";
import { buildWorld, type World } from "#/test/world";

import type { DataRead } from "./define";
import * as data from "./index";

// The permission suite (4.5): every protected read is declared with its access, and this file
// attacks each one as eight kinds of user. Adding a read means adding one row to `cases`; the
// completeness test fails until you do.

// oxlint-disable-next-line typescript/no-explicit-any
type AnyRead = DataRead<any, unknown>;

interface Case {
  read: AnyRead;
  input: (world: World) => unknown;
  /** Whose records the input points at, for the conflict-of-interest tests */
  owner: "A" | "admin" | null;
}

const cases: Case[] = [
  { read: data.listMyPolicies, input: () => ({}), owner: null },
  { read: data.getMyPolicy, input: (w) => ({ policyId: w.records.policyA.id }), owner: "A" },
  { read: data.listMyClaims, input: () => ({}), owner: null },
  { read: data.getMyClaim, input: (w) => ({ claimId: w.records.claimA.id }), owner: "A" },
  { read: data.staffListClaims, input: () => ({}), owner: null },
  { read: data.staffGetClaim, input: (w) => ({ claimId: w.records.claimA.id }), owner: "A" },
  { read: data.staffListReferrals, input: () => ({}), owner: null },
  {
    read: data.staffGetReferral,
    input: (w) => ({ quoteItemId: w.records.referralA.item.id }),
    owner: "A",
  },
];

const actorNames = [
  "guest",
  "customerA",
  "customerB",
  "handler",
  "admin",
  "deactivatedHandler",
  "adminCustomer",
  "rolelessStaff",
  "handlerNoCustomer",
] as const;

let world: World;
beforeEach(async () => {
  await truncateAll();
  world = await buildWorld();
});
afterAll(closeDb);
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The AuthzError code a call fails with, or null if it didn't throw one */
async function codeOf(call: () => Promise<unknown>): Promise<AuthzCode | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof AuthzError) return error.code;
    throw error;
  }
}

describe("access from the map", () => {
  const rows = cases.flatMap(({ read, input, owner }, index) =>
    actorNames.map((actorName) => ({
      name: `case ${index} as ${actorName}`,
      read,
      input,
      actorName,
      owner,
    })),
  );

  it.each(rows)("$name", async ({ read, input, actorName, owner }) => {
    const actor: Actor | null = world[actorName];
    const code = await codeOf(() => read(actor, input(world)));

    if (actor === null) {
      expect(code).toBe("UNAUTHENTICATED");
    } else if (read.access === "signed_in") {
      expect(code).not.toBe("UNAUTHENTICATED");
      expect(code).not.toBe("FORBIDDEN");
      // A record read of A's is A's alone: everyone else, staff included, gets NOT_FOUND
      if (owner === "A") expect(code).toBe(actorName === "customerA" ? null : "NOT_FOUND");
    } else if (actor.staff?.permissions.has(read.access)) {
      // Allowed staff (admin too) read A's record unless it is their own, which none of them is
      if (owner === "A") expect(actor.customerId).not.toBe(world.customerA?.customerId);
      expect(code).toBeNull();
    } else {
      expect(code).toBe("FORBIDDEN");
    }
  });
});

describe("customer reads", () => {
  it("hides someone else's policy and claim as not found", async () => {
    const { customerB, records } = world;
    expect(await codeOf(() => data.getMyPolicy(customerB, { policyId: records.policyA.id }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(() => data.getMyClaim(customerB, { claimId: records.claimA.id }))).toBe(
      "NOT_FOUND",
    );
  });

  it("lists none of someone else's records", async () => {
    const { customerB, records } = world;
    const policies = await data.listMyPolicies(customerB, {});
    const claims = await data.listMyClaims(customerB, {});
    expect(policies.map((p) => p.id)).toEqual([records.policyB.id]);
    expect(claims.map((c) => c.id)).toEqual([records.claimB.id]);
  });

  it("gives a customer their own policy with its claims", async () => {
    const { customerA, records } = world;
    const policy = await data.getMyPolicy(customerA, { policyId: records.policyA.id });
    expect(policy.id).toBe(records.policyA.id);
    expect(policy.claims.map((c) => c.id).sort()).toEqual(
      [records.claimA.id, records.draftClaimA.id].sort(),
    );
    expect(policy).not.toHaveProperty("customerId");
    expect(policy).not.toHaveProperty("quoteId");
  });

  it("lists a customer's own claims, drafts included", async () => {
    const ids = (await data.listMyClaims(world.customerA, {})).map((c) => c.id);
    expect(ids).toContain(world.records.draftClaimA.id);
    expect(ids).toContain(world.records.claimA.id);
  });

  it("gives staff with no customer row an empty list and no claim", async () => {
    const { handlerNoCustomer, records } = world;
    expect(await data.listMyPolicies(handlerNoCustomer, {})).toEqual([]);
    expect(await data.listMyClaims(handlerNoCustomer, {})).toEqual([]);
    expect(
      await codeOf(() => data.getMyClaim(handlerNoCustomer, { claimId: records.claimA.id })),
    ).toBe("NOT_FOUND");
  });

  it("keeps internal notes off the customer's claim", async () => {
    const claim = await data.getMyClaim(world.customerA, { claimId: world.records.claimA.id });
    expect(claim.events.map((e) => e.type)).toEqual(["submitted"]);
    expect(JSON.stringify(claim)).not.toContain("Staff only");
    expect(claim).not.toHaveProperty("customerId");
    expect(claim).not.toHaveProperty("assignedHandlerId");
  });

  it.each(["", "not-a-uuid", "'; drop table claims;--", randomUUID()])(
    "treats the id %j as not found",
    async (id) => {
      const { customerA } = world;
      expect(await codeOf(() => data.getMyPolicy(customerA, { policyId: id }))).toBe("NOT_FOUND");
      expect(await codeOf(() => data.getMyClaim(customerA, { claimId: id }))).toBe("NOT_FOUND");
    },
  );
});

describe("staff reads", () => {
  it("shows a handler the internal events on a claim", async () => {
    const claim = await data.staffGetClaim(world.handler, { claimId: world.records.claimA.id });
    expect(claim.events.map((e) => e.visibility).sort((a, b) => a.localeCompare(b))).toEqual([
      "customer",
      "internal",
    ]);
    expect(claim.customerId).toBe(world.customerA!.customerId);
  });

  it("refuses an admin who is also the customer their own claim and referral", async () => {
    const { adminCustomer, records } = world;
    expect(
      await codeOf(() => data.staffGetClaim(adminCustomer, { claimId: records.adminClaim.id })),
    ).toBe("CONFLICT_OF_INTEREST");
    expect(
      await codeOf(() =>
        data.staffGetReferral(adminCustomer, { quoteItemId: records.adminReferral.item.id }),
      ),
    ).toBe("CONFLICT_OF_INTEREST");
  });

  it("leaves an admin's own records out of their lists", async () => {
    const { adminCustomer, records } = world;
    const claimIds = (await data.staffListClaims(adminCustomer, {})).map((c) => c.id);
    expect(claimIds).toContain(records.claimA.id);
    expect(claimIds).not.toContain(records.adminClaim.id);
    const itemIds = (await data.staffListReferrals(adminCustomer, {})).map((r) => r.quoteItemId);
    expect(itemIds).toContain(records.referralA.item.id);
    expect(itemIds).not.toContain(records.adminReferral.item.id);
  });

  it("filters the claims queue by status", async () => {
    const claims = await data.staffListClaims(world.handler, { status: "draft" });
    expect(claims.map((c) => c.id)).toEqual([world.records.draftClaimA.id]);
  });

  it("shows staff with no customer row everyone's records", async () => {
    const { handlerNoCustomer, records } = world;
    const claimIds = (await data.staffListClaims(handlerNoCustomer, {})).map((c) => c.id);
    expect(claimIds).toContain(records.claimA.id);
    expect(claimIds).toContain(records.adminClaim.id);
    const itemIds = (await data.staffListReferrals(handlerNoCustomer, {})).map(
      (r) => r.quoteItemId,
    );
    expect(itemIds).toContain(records.referralA.item.id);
    expect(itemIds).toContain(records.adminReferral.item.id);
  });

  it("drops a decided referral from the queue but keeps it readable with its history", async () => {
    const { handler, records } = world;
    const db = getDb();
    const itemId = records.referralA.item.id;
    await db.update(quoteItems).set({ outcome: "quoted" }).where(eq(quoteItems.id, itemId));
    await db
      .insert(underwritingDecisions)
      .values({ quoteItemId: itemId, outcome: "quoted", decidedBy: handler!.userId });
    const queue = (await data.staffListReferrals(handler, {})).map((r) => r.quoteItemId);
    expect(queue).not.toContain(itemId);
    const referral = await data.staffGetReferral(handler, { quoteItemId: itemId });
    expect(referral.decisions.map((d) => d.outcome).sort((a, b) => a.localeCompare(b))).toEqual([
      "quoted",
      "referred",
    ]);
  });

  it("returns an item still marked referred even with no decision row", async () => {
    const { items } = await makeQuote();
    const itemId = items[0]!.item.id;
    await getDb()
      .update(quoteItems)
      .set({ outcome: "referred", reasonCode: "high_value_vehicle" })
      .where(eq(quoteItems.id, itemId));
    const referral = await data.staffGetReferral(world.handler, { quoteItemId: itemId });
    expect(referral.quoteItemId).toBe(itemId);
    expect(referral.decisions).toEqual([]);
  });

  it("treats an item that was never referred as not found", async () => {
    const { items } = await makeQuote();
    expect(
      await codeOf(() => data.staffGetReferral(world.handler, { quoteItemId: items[0]!.item.id })),
    ).toBe("NOT_FOUND");
  });

  it.each(["", "not-a-uuid", "'; drop table claims;--", randomUUID()])(
    "treats the id %j as not found",
    async (id) => {
      const { handler } = world;
      expect(await codeOf(() => data.staffGetClaim(handler, { claimId: id }))).toBe("NOT_FOUND");
      expect(await codeOf(() => data.staffGetReferral(handler, { quoteItemId: id }))).toBe(
        "NOT_FOUND",
      );
    },
  );

  it.each([0, 101, -1, 1.5])("treats limit %j as not found", async (limit) => {
    const { handler } = world;
    expect(await codeOf(() => data.staffListClaims(handler, { limit }))).toBe("NOT_FOUND");
    expect(await codeOf(() => data.staffListReferrals(handler, { limit }))).toBe("NOT_FOUND");
  });
});

describe("audit of staff views (4.5b)", () => {
  const keys = parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION);
  const auditRows = () => getDb().select().from(auditLog).orderBy(asc(auditLog.id));

  it("writes one claim.viewed row when a handler opens a claim", async () => {
    const { handler, records } = world;
    await data.staffGetClaim(handler, { claimId: records.claimA.id });
    expect(await auditRows()).toMatchObject([
      {
        action: "claim.viewed",
        entityType: "claim",
        entityId: records.claimA.id,
        actorUserId: handler!.userId,
        actorRole: "claims_handler",
        changes: null,
      },
    ]);
  });

  it("writes one referral.viewed row when a handler opens a referral", async () => {
    const { handler, records } = world;
    await data.staffGetReferral(handler, { quoteItemId: records.referralA.item.id });
    expect(await auditRows()).toMatchObject([
      {
        action: "referral.viewed",
        entityType: "quote_item",
        entityId: records.referralA.item.id,
        actorUserId: handler!.userId,
        actorRole: "claims_handler",
        changes: null,
      },
    ]);
  });

  it("writes nothing for a conflict of interest, a missing record or a customer", async () => {
    const { adminCustomer, customerA, handler, records } = world;
    expect(
      await codeOf(() => data.staffGetClaim(adminCustomer, { claimId: records.adminClaim.id })),
    ).toBe("CONFLICT_OF_INTEREST");
    expect(
      await codeOf(() =>
        data.staffGetReferral(adminCustomer, { quoteItemId: records.adminReferral.item.id }),
      ),
    ).toBe("CONFLICT_OF_INTEREST");
    expect(await codeOf(() => data.staffGetClaim(handler, { claimId: randomUUID() }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(() => data.staffGetReferral(handler, { quoteItemId: randomUUID() }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(() => data.staffGetClaim(customerA, { claimId: records.claimA.id }))).toBe(
      "FORBIDDEN",
    );
    expect(await auditRows()).toHaveLength(0);
  });

  it("leaves a chain that verifies after a mix of views", async () => {
    const { handler, admin, records } = world;
    await data.staffGetClaim(handler, { claimId: records.claimA.id });
    await data.staffGetReferral(admin, { quoteItemId: records.referralA.item.id });
    await data.staffGetClaim(admin, { claimId: records.claimA.id });
    expect(await verifyAuditChain(getOwnerDb().$client, keys)).toMatchObject({
      ok: true,
      rows: 3,
    });
  });

  it("throws and writes nothing when the keys are missing, without leaking key text", async () => {
    vi.stubEnv("AUDIT_HMAC_KEYS", "");
    let message = "";
    try {
      await data.staffGetClaim(world.handler, { claimId: world.records.claimA.id });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("AQEB");
    vi.unstubAllEnvs();
    expect(await auditRows()).toHaveLength(0);
  });
});

// Every module in src/server/data/ except these, whether or not index.ts re-exports it
const modules = import.meta.glob(
  ["./*.ts", "!./*.test.ts", "!./index.ts", "!./define.ts", "!./summaries.ts"],
  {
    eager: true,
  },
) as Record<string, Record<string, unknown>>;
const found = Object.entries(modules).flatMap(([file, exports]) =>
  Object.entries(exports)
    .filter(([, value]) => typeof value === "function")
    .map(([name, read]) => ({ label: `${file} ${name}`, name, read })),
);
const indexed = new Set(Object.values(data));

describe("completeness", () => {
  it("finds the data modules", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it.each(found)(
    "$label is exported from index.ts, declares access and has a case",
    ({ name, read }) => {
      expect(indexed.has(read as never), `${name} is not exported from index.ts`).toBe(true);
      expect(typeof (read as AnyRead).access, `${name} has no access`).toBe("string");
      expect(
        cases.some((c) => c.read === read),
        `${name} is missing from the cases table`,
      ).toBe(true);
    },
  );
});
