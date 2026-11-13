import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type { Actor } from "#/server/auth/actor";
import { AuthzError, type AuthzCode } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { parseKeys } from "#/server/audit/chain";
import { verifyAuditChain } from "#/server/audit/verify";
import { auditLog, quoteItems, underwritingDecisions } from "#/server/db/schema";
import { AuditConfigError } from "#/server/env";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";
import { getOwnerDb, REFERENCE_TABLES, truncateAll, truncateExcept } from "#/test/db";
import { makeQuote } from "#/test/factories";
import { makePurchase } from "#/test/purchase";
import { buildWorld, type World } from "#/test/world";

import type { DataRead } from "./define";
import * as data from "./index";
import { clearReferenceCaches, getActiveRatingTables, upsertReferenceData } from "./reference";

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

// A bought quote of customer A's, with a real rating version so its credit charge loads (5.6)
let purchaseA: { quoteId: string };

const cases: Case[] = [
  { read: data.listMyPolicies, input: () => ({}), owner: null },
  { read: data.getMyPolicy, input: (w) => ({ policyId: w.records.policyA.id }), owner: "A" },
  { read: data.listMyQuotes, input: () => ({}), owner: null },
  { read: data.getQuoteForPayment, input: () => ({ quoteId: purchaseA.quoteId }), owner: "A" },
  { read: data.getPurchase, input: () => ({ quoteId: purchaseA.quoteId }), owner: "A" },
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
  { read: data.listMyClaimFiles, input: (w) => ({ claimId: w.records.claimA.id }), owner: "A" },
  { read: data.getMyFileUrl, input: (w) => ({ fileId: w.records.fileA.id }), owner: "A" },
  {
    read: data.staffListClaimFiles,
    input: (w) => ({ reference: w.records.claimA.reference }),
    owner: "A",
  },
  { read: data.staffGetFileUrl, input: (w) => ({ fileId: w.records.fileA.id }), owner: "A" },
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
beforeAll(async () => {
  // The rating versions are loaded once; each test clears only what it writes
  await truncateAll();
  clearReferenceCaches();
  await upsertReferenceData(getOwnerDb(), {
    rating: structuredClone(RATING_SOURCES),
    catalogue: structuredClone(CATALOGUE_SOURCES),
  });
});
beforeEach(async () => {
  // The file reads sign links (4.10); the fake store signs them without R2
  setObjectStore(new MemoryObjectStore());
  await truncateExcept(REFERENCE_TABLES);
  world = await buildWorld();
  // The factories' quotes carry bare rating versions; listMyQuotes loads each quote's own, so
  // they are re-pointed at the real car version
  const ratingVersionId = (await getActiveRatingTables("car")).id;
  await getDb().update(quoteItems).set({ ratingVersionId });
  const { quote } = await makePurchase({
    customerId: world.customerA!.customerId!,
    ratingVersionId,
  });
  purchaseA = { quoteId: quote.id };
});
afterAll(closeDb);
afterEach(() => {
  setObjectStore(null);
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
      .set({ outcome: "referred", reasonCode: "high_vehicle_value" })
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
    // Malformed but key-like (too short), so there is key text that a leak would expose
    vi.stubEnv("AUDIT_HMAC_KEYS", "v1:AQEBAQEB");
    let thrown: unknown;
    let result: unknown;
    try {
      result = await data.staffGetClaim(world.handler, { claimId: world.records.claimA.id });
    } catch (error) {
      thrown = error;
    }
    vi.unstubAllEnvs();
    expect(result).toBeUndefined();
    expect(thrown).toBeInstanceOf(AuditConfigError);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Audit \(4\.5b\)/);
    expect(message).not.toContain("AQEBAQEB");
    expect(message).not.toContain(process.env.DATABASE_URL ?? "<unset>");
    expect(message).not.toContain("kerb_app:");
    expect(await auditRows()).toHaveLength(0);
  });
});

// Every module in src/server/data/ except these, whether or not index.ts re-exports it. account.ts
// holds plain helpers for the actor lookup and closure, not protected reads (4.7); reference.ts is
// the catalogue and rates, the same for everyone and written only by the deploy (4.8); file-rows.ts
// is the upload row helpers behind the account hooks and the cleanup (4.10); job-rows.ts is the
// jobs table's helpers behind the runner (4.11); event-rows.ts is the guest funnel writes (5.1);
// postcode-rows.ts is the guest postcode cache (5.2); quote-rows.ts and save-quote.ts are a priced
// quote's row builder and its transaction (5.4), which 5.6 wraps in a protected write.
const modules = import.meta.glob(
  [
    "./*.ts",
    "!./*.test.ts",
    "!./index.ts",
    "!./define.ts",
    "!./summaries.ts",
    "!./account.ts",
    "!./reference.ts",
    "!./file-rows.ts",
    "!./job-rows.ts",
    "!./event-rows.ts",
    "!./postcode-rows.ts",
    "!./quote-rows.ts",
    "!./save-quote.ts",
  ],
  {
    eager: true,
  },
) as Record<string, Record<string, unknown>>;
const found = Object.entries(modules).flatMap(([file, exports]) =>
  Object.entries(exports)
    // Writes join the suite in 6.10 (decision 7)
    .filter(
      ([, value]) => typeof value === "function" && (value as { kind?: string }).kind !== "write",
    )
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
