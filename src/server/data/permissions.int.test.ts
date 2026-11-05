import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/server/auth/actor";
import { AuthzError, type AuthzCode } from "#/server/auth/errors";
import { closeDb } from "#/server/db/client";
import { truncateAll } from "#/test/db";
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
      expect(code).not.toBe("FORBIDDEN");
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

describe("completeness", () => {
  it.each(Object.entries(data))("%s declares its access and has a case", (name, read) => {
    expect(typeof (read as AnyRead).access, `${name} has no access`).toBe("string");
    expect(
      cases.some((c) => c.read === read),
      `${name} is missing from the cases table`,
    ).toBe(true);
  });
});
