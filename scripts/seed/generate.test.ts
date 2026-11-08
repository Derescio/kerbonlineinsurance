import { describe, expect, it } from "vite-plus/test";

import { OPEN_CLAIM_STATUSES } from "#/server/account/constants";
import { expandCatalogue } from "#/server/reference/catalogue/expand";
import { CATALOGUE_SOURCES } from "#/server/reference/catalogue/index";
import { RATING_SOURCES } from "#/server/reference/rating/index";

import { generateSeed } from "./generate.ts";
import { SEED_FROM, SEED_TO } from "./random.ts";
import type { SeedContext, SeedPlan } from "./types.ts";

const hex = (n: number) => n.toString(16).padStart(12, "0");

function context(crowdSize: number): SeedContext {
  return {
    catalogue: expandCatalogue(CATALOGUE_SOURCES).map((row, i) => ({
      ...row,
      id: `00000000-0000-4000-8000-${hex(i)}`,
    })),
    versions: {
      car: { id: "00000000-0000-4000-8000-c00000000001", source: RATING_SOURCES[0]! },
      home: { id: "00000000-0000-4000-8000-c00000000002", source: RATING_SOURCES[1]! },
      business: { id: "00000000-0000-4000-8000-c00000000003", source: RATING_SOURCES[2]! },
    },
    inbox: { local: "damionwilson", domain: "opsedsolutions.com" },
    crowdSize,
  };
}

const plan = generateSeed(context(50));
const castUser = (p: SeedPlan, role: string) => p.users.find((u) => u.cast === role)!;
const customerOf = (p: SeedPlan, userId: string) => p.customers.find((c) => c.userId === userId)!;

describe("generateSeed", () => {
  it("is deterministic", () => {
    expect(generateSeed(context(50))).toEqual(plan);
  });

  it("keeps the first customers identical when the crowd grows", () => {
    const bigger = generateSeed(context(60));
    expect(bigger.customers.slice(0, plan.customers.length)).toEqual(plan.customers);
    expect(bigger.quotes.slice(0, plan.quotes.length)).toEqual(plan.quotes);
  });

  it("fills every table", () => {
    for (const [table, rows] of Object.entries(plan)) {
      expect(rows.length, table).toBeGreaterThan(0);
    }
    expect(plan.accountClosures.some((c) => c.cancelledAt)).toBe(true);
    expect(plan.accountClosures.some((c) => c.closedAt)).toBe(true);
  });

  it("reconciles every quote", () => {
    for (const quote of plan.quotes) {
      const items = plan.quoteItems.filter((i) => i.quoteId === quote.id);
      const selected = items.flatMap((item) =>
        plan.quoteItemOptions.filter((o) => o.id === item.selectedOptionId),
      );
      const addons = plan.quoteItemAddons.filter(
        (a) => a.selected && items.some((i) => i.id === a.quoteItemId),
      );
      const subtotal =
        selected.reduce((sum, o) => sum + o.annualPremiumPence, 0) +
        addons.reduce((sum, a) => sum + a.annualPricePence, 0);
      expect(quote.subtotalPence, quote.reference).toBe(subtotal);
      expect(quote.totalPence).toBe(
        quote.subtotalPence! - quote.bundleDiscountPence! + quote.feesPence! + quote.iptPence!,
      );
    }
  });

  it("has each cast member once", () => {
    for (const role of [
      "customer-a",
      "customer-b",
      "business",
      "closure-settled",
      "closure-held",
      "handler",
      "admin",
    ]) {
      expect(
        plan.users.filter((u) => u.cast === role),
        role,
      ).toHaveLength(1);
    }
    expect(castUser(plan, "customer-a").email).toBe("damionwilson+customer-a@opsedsolutions.com");
  });

  it("gives the cast their stories", () => {
    const handler = castUser(plan, "handler");
    const claimsOf = (role: string) =>
      plan.claims.filter((c) => c.customerId === customerOf(plan, castUser(plan, role).id).id);

    const b = claimsOf("customer-b");
    expect(b.map((c) => c.status)).toEqual(["assessing"]);
    expect(b[0]!.assignedHandlerId).toBe(handler.id);

    const held = claimsOf("closure-held");
    expect(held.some((c) => (OPEN_CLAIM_STATUSES as readonly string[]).includes(c.status!))).toBe(
      true,
    );
    expect(claimsOf("closure-settled").map((c) => c.status)).toEqual(["settled"]);

    const a = customerOf(plan, castUser(plan, "customer-a").id);
    expect(plan.bundles.filter((b) => b.customerId === a.id)).toHaveLength(1);
    expect(
      plan.reviews.filter((r) => r.customerId === a.id && r.status === "published"),
    ).toHaveLength(1);

    const business = customerOf(plan, castUser(plan, "business").id);
    const quoteIds = plan.quotes.filter((q) => q.customerId === business.id).map((q) => q.id);
    const referred = plan.quoteItems.filter(
      (i) => quoteIds.includes(i.quoteId) && i.outcome === "referred",
    );
    expect(referred).toHaveLength(1);
    expect(
      plan.underwritingDecisions.filter((d) => d.quoteItemId === referred[0]!.id),
    ).toHaveLength(1);
  });

  it("keeps every createdAt inside the window", () => {
    for (const [table, rows] of Object.entries(plan)) {
      if (table === "audit") continue;
      for (const row of rows as { createdAt?: Date }[]) {
        if (!row.createdAt) continue;
        expect(row.createdAt.getTime(), table).toBeGreaterThanOrEqual(SEED_FROM.getTime());
        expect(row.createdAt.getTime(), table).toBeLessThanOrEqual(SEED_TO.getTime());
      }
    }
  });

  it("uses the 9-range references", () => {
    for (const q of plan.quotes) expect(q.reference).toMatch(/^KRB-Q-9[0-9]{4}$/);
    for (const p of plan.policies) expect(p.reference).toMatch(/^KRB-9[0-9]{5}$/);
    for (const c of plan.claims) expect(c.reference).toMatch(/^KRB-C-9[0-9]{4}$/);
  });

  it("never has staff work on their own records", () => {
    const userOfCustomer = new Map(plan.customers.map((c) => [c.id, c.userId]));
    for (const claim of plan.claims) {
      if (claim.assignedHandlerId) {
        expect(claim.assignedHandlerId).not.toBe(userOfCustomer.get(claim.customerId));
      }
    }
    const customerOfQuote = new Map(plan.quotes.map((q) => [q.id, q.customerId]));
    const quoteOfItem = new Map(plan.quoteItems.map((i) => [i.id, i.quoteId]));
    for (const d of plan.underwritingDecisions) {
      if (!d.decidedBy) continue;
      const customer = customerOfQuote.get(quoteOfItem.get(d.quoteItemId)!);
      expect(d.decidedBy).not.toBe(userOfCustomer.get(customer!));
    }
  });

  it("scrubs closed accounts the way 4.7 does", () => {
    const closed = plan.accountClosures.filter((c) => c.closedAt);
    for (const closure of closed) {
      const user = plan.users.find((u) => u.id === closure.userId)!;
      expect(user.scrubbed).toBe(true);
      expect(user.email).toBe(`closed+${user.id}@closed.invalid`);
      expect(plan.notifications.some((n) => n.userId === user.id)).toBe(false);
      expect(closure.closesAt!.getTime() - closure.requestedAt!.getTime()).toBe(30 * 86_400_000);
    }
  });
});
