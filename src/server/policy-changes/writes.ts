import { z } from "zod";

import {
  CANT_CHANGE_ONLINE,
  CHANGE_GONE,
  CHANGE_WAITING,
  homeWarning,
  PRICE_CHANGED,
} from "#/features/policy-changes/copy";
import type { PolicyChangeRequest } from "#/features/policy-changes/request";
import { policyChangeSchema } from "#/features/policy-changes/schema";
import { todayIso } from "#/features/quote/schemas/dates";
import type { WriteResult } from "#/lib/validation";
import type { Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { checkoutDb } from "#/server/data/checkout-rows";
import { defineWrite, type DataWrite, type WriteEnvelope } from "#/server/data/define";
import {
  activeHomeAddressLine,
  insertPolicyChange,
  loadPolicyForChange,
  lockMyPolicyChange,
  myChange,
  myPolicyId,
  openChangeFor,
  updatePolicyChange,
  type StoredPolicy,
} from "#/server/data/policy-change-rows";
import { policyReference } from "#/server/data/policies";
import { POLICY_CHANGE_PRICE_RULE } from "#/server/data/rate-limit-rules";
import { getRatingTables } from "#/server/data/reference";
import type { CoverLevel } from "#/server/db/schema/values";
import type { Tx } from "#/server/db/tx";
import { expireAtStripe } from "#/server/payments/expire-session";
import type { JobDeps } from "#/server/jobs/types";
import { getStripe, type StripeClient } from "#/server/payments/stripe";

import { changePolicy, sendChangeEmail } from "./apply";
import { changesNothing, ineligible, refusedChange } from "./eligibility";
import { coverLevelLines, offeredAddons, priceChange, type PricedChange } from "./price";
import { resolveChange } from "./resolve";
import { completeTopUp, settleApplied, startTopUp } from "./settle";

// A customer's policy changes (6.3b, decisions 6, 7, 14 and 15): price one (writing the priced
// policy_changes row the dialog confirms), confirm it, or abandon it. Each is built per call, so
// its schema checks dates against `now`, and a test can pass the clock and Stripe client.

export interface PolicyChangeDeps {
  now?: Date;
  stripe?: StripeClient;
  /** The email runner's deps; tests hold the emails */
  jobs?: JobDeps;
}

export type PriceChangeResult =
  | {
      status: "priced";
      changeId: string;
      priceLine: string;
      settlement: "charge" | "refund" | "instalments" | "none";
      amountPence: number;
      homeWarning: string | null;
      /** A cover change's price line at each level, with the same add-ons and excess */
      levels: { coverLevel: CoverLevel; available: boolean; priceLine: string | null }[];
      /** A cover change's add-ons on offer, priced for a year */
      addons: { addon: string; annualPricePence: number }[];
    }
  | { status: "refused"; message: string }
  /** Nothing would change (decision 13's dialog opens on the current cover): no row, no Confirm */
  | {
      status: "unchanged";
      levels: { coverLevel: CoverLevel; available: boolean; priceLine: string | null }[];
      addons: { addon: string; annualPricePence: number }[];
    };

export type ConfirmChangeResult =
  | { status: "applied" }
  | { status: "pay"; clientSecret: string }
  | { status: "refused"; message: string; priceLine?: string };

/** A refused attempt's row: what was asked, the outcome, and no money */
async function recordRefused(
  tx: Tx,
  stored: StoredPolicy,
  change: PolicyChangeRequest,
  priced: Extract<PricedChange, { outcome: "referred" | "declined" }>,
): Promise<void> {
  await insertPolicyChange(tx, {
    policyId: stored.policy.id,
    customerId: stored.policy.customerId,
    kind: change.kind,
    request: change,
    fromVersion: stored.policy.version,
    oldAnnualPence: stored.policy.annualPremiumPence,
    newAnnualPence: stored.policy.annualPremiumPence,
    priceBeforePence: 0,
    priceAfterPence: 0,
    outcome: priced.outcome,
    reasonCode: priced.reasonCode,
    settlement: "none",
    amountPence: 0,
    status: "refused",
  });
}

async function price(
  actor: Actor | null,
  raw: WriteEnvelope,
  ctx: { headers: Headers },
  deps: PolicyChangeDeps = {},
): Promise<WriteResult<PriceChangeResult>> {
  const now = deps.now ?? new Date();
  const today = todayIso(now);
  const write = defineWrite<{ reference: string; change: PolicyChangeRequest }, PriceChangeResult>(
    z.object({ reference: policyReference, change: policyChangeSchema(today) }),
    { limit: { action: "policy.change_price", rule: POLICY_CHANGE_PRICE_RULE } },
    async (actor, { reference, change }, tx) => {
      if (!actor.customerId) throw new AuthzError("NOT_FOUND");
      const policyId = await myPolicyId(tx, reference, actor.customerId);
      if (!policyId) throw new AuthzError("NOT_FOUND");
      const stored = await loadPolicyForChange(tx, policyId);
      if (!stored) return { status: "refused", message: CANT_CHANGE_ONLINE };
      const tables = await getRatingTables(tx, stored.ratingVersionId);
      const notNow = ineligible(stored, today);
      if (notNow) return { status: "refused", message: notNow };
      const resolved = await resolveChange(tx, change);
      if ("refused" in resolved) return { status: "refused", message: resolved.refused };
      const refusal = await refusedChange(tx, stored, resolved, tables, today);
      if (refusal) return { status: "refused", message: refusal };
      if (changesNothing(stored, resolved)) {
        return {
          status: "unchanged",
          levels: resolved.kind === "cover" ? coverLevelLines(stored, resolved, tables, today) : [],
          addons: change.kind === "cover" ? offeredAddons(stored, tables, today) : [],
        };
      }

      const priced = priceChange(stored, resolved, tables, today);
      if (priced.outcome !== "quoted") {
        await recordRefused(tx, stored, change, priced);
        return { status: "refused", message: CANT_CHANGE_ONLINE };
      }
      const changeId = await insertPolicyChange(tx, {
        policyId: stored.policy.id,
        customerId: stored.policy.customerId,
        kind: change.kind,
        request: change,
        fromVersion: stored.policy.version,
        oldAnnualPence: priced.oldAnnualPence,
        newAnnualPence: priced.newAnnualPence,
        priceBeforePence: priced.before.totalPence,
        priceAfterPence: priced.after.totalPence,
        outcome: "quoted",
        settlement: priced.settlement,
        amountPence: priced.amountPence,
      });
      const home =
        change.kind === "address"
          ? await activeHomeAddressLine(tx, stored.policy.customerId, today)
          : null;
      return {
        status: "priced",
        changeId,
        priceLine: priced.priceLine,
        settlement: priced.settlement,
        amountPence: priced.amountPence,
        homeWarning: home ? homeWarning(home) : null,
        levels: resolved.kind === "cover" ? coverLevelLines(stored, resolved, tables, today) : [],
        addons: change.kind === "cover" ? offeredAddons(stored, tables, today) : [],
      };
    },
  );
  return write(actor, raw, ctx);
}

async function confirm(
  actor: Actor | null,
  raw: WriteEnvelope,
  ctx: { headers: Headers },
  deps: PolicyChangeDeps = {},
): Promise<WriteResult<ConfirmChangeResult>> {
  const now = deps.now ?? new Date();
  const today = todayIso(now);
  let emailJobId: number | null = null;
  const write = defineWrite<{ changeId: string }, ConfirmChangeResult>(
    z.object({ changeId: z.uuid() }),
    { idempotent: { action: "policy.change_confirm" } },
    async (actor, { changeId }, tx) => {
      if (!actor.customerId) throw new AuthzError("NOT_FOUND");
      const row = await lockMyPolicyChange(tx, changeId, actor.customerId);
      if (!row) throw new AuthzError("NOT_FOUND");
      if (row.status === "applied") return { status: "applied" };
      if (row.status !== "priced") return { status: "refused", message: CHANGE_GONE };

      const stored = await loadPolicyForChange(tx, row.policyId);
      // The stored request is resolved again: a catalogue row can be withdrawn since it was priced
      const resolved = await resolveChange(tx, row.request as PolicyChangeRequest);
      const change = "refused" in resolved ? null : resolved;
      const tables = stored ? await getRatingTables(tx, stored.ratingVersionId) : null;
      const refusal =
        stored && tables && change
          ? (ineligible(stored, today) ?? (await refusedChange(tx, stored, change, tables, today)))
          : CANT_CHANGE_ONLINE;
      if (!stored || !tables || !change || refusal) {
        await updatePolicyChange(tx, changeId, { status: "abandoned", failureReason: "refused" });
        return { status: "refused", message: refusal ?? CANT_CHANGE_ONLINE };
      }

      // Priced again under the policy's lock: anything that moved since the dialog's price is
      // refused with today's line (decision 14)
      const priced = priceChange(stored, change, tables, today);
      if (priced.outcome !== "quoted") {
        await updatePolicyChange(tx, changeId, { status: "abandoned", failureReason: "refused" });
        return { status: "refused", message: CANT_CHANGE_ONLINE };
      }
      if (
        stored.policy.version !== row.fromVersion ||
        priced.newAnnualPence !== row.newAnnualPence ||
        priced.amountPence !== row.amountPence ||
        priced.settlement !== row.settlement
      ) {
        await updatePolicyChange(tx, changeId, {
          status: "abandoned",
          failureReason: "price_changed",
        });
        return { status: "refused", message: PRICE_CHANGED, priceLine: priced.priceLine };
      }

      // One change waits for its top-up at a time (decision 7): the dialog offers to finish it
      const open = await openChangeFor(tx, stored.policy.id);
      if (open && open.id !== changeId) {
        await updatePolicyChange(tx, changeId, { status: "abandoned", failureReason: "waiting" });
        return { status: "refused", message: CHANGE_WAITING };
      }
      const settleDeps = { stripe: deps.stripe ?? getStripe(), now };
      if (priced.settlement === "charge") {
        const { clientSecret } = await startTopUp(tx, changeId, stored, change, priced, settleDeps);
        return { status: "pay", clientSecret };
      }
      ({ emailJobId } = await changePolicy(tx, { stored, change, priced, changeId, actor, now }));
      await settleApplied(tx, changeId, stored, priced, settleDeps);
      return { status: "applied" };
    },
  );
  const result = await write(actor, raw, ctx);
  // After the commit, so the email never goes for a change that rolled back
  if (result.ok) sendChangeEmail(emailJobId, deps.jobs);
  return result;
}

async function abandon(
  actor: Actor | null,
  raw: WriteEnvelope,
  ctx: { headers: Headers },
  deps: PolicyChangeDeps = {},
): Promise<WriteResult<{ status: "abandoned" }>> {
  const write = defineWrite<{ changeId: string }, { status: "abandoned" }>(
    z.object({ changeId: z.uuid() }),
    {},
    async (actor, { changeId }, tx) => {
      if (!actor.customerId) throw new AuthzError("NOT_FOUND");
      const row = await lockMyPolicyChange(tx, changeId, actor.customerId);
      if (!row) throw new AuthzError("NOT_FOUND");
      // A top-up Stripe already has paid stays waiting: its webhook applies the change
      if (row.status === "awaiting_payment" && row.stripeSessionId) {
        const at = await expireAtStripe(deps.stripe ?? getStripe(), row.stripeSessionId);
        if (at === "complete") return { status: "abandoned" };
      }
      if (row.status === "priced" || row.status === "awaiting_payment") {
        await updatePolicyChange(tx, changeId, { status: "abandoned" });
      }
      return { status: "abandoned" };
    },
  );
  return write(actor, raw, ctx);
}

const asWrite = <F>(fn: F) =>
  Object.assign(fn as F & object, { access: "signed_in" as const, kind: "write" as const });

export const priceMyPolicyChange: DataWrite<PriceChangeResult> & typeof price = asWrite(price);
export const confirmMyPolicyChange: DataWrite<ConfirmChangeResult> & typeof confirm =
  asWrite(confirm);
export const abandonMyPolicyChange: DataWrite<{ status: "abandoned" }> & typeof abandon =
  asWrite(abandon);

/**
 * Back on the policy page with a top-up waiting (decision 7): asks Stripe whether its session is
 * paid and, if so, applies the change as checkout.session.completed would. The page doesn't wait
 * for the webhook, which may be late, or (on a PR preview) never come. Idempotent with the webhook.
 */
export async function checkMyTopUp(
  actor: Actor | null,
  raw: unknown,
  deps: PolicyChangeDeps = {},
): Promise<{ status: string }> {
  if (!actor?.customerId) throw new AuthzError("NOT_FOUND");
  const parsed = z.object({ changeId: z.uuid() }).safeParse(raw);
  if (!parsed.success) throw new AuthzError("NOT_FOUND");
  const { changeId } = parsed.data;
  const db = checkoutDb();
  const row = await myChange(db, changeId, actor.customerId);
  if (!row) throw new AuthzError("NOT_FOUND");
  if (row.status === "awaiting_payment" && row.stripeSessionId) {
    await completeTopUp(row.stripeSessionId, {
      stripe: deps.stripe ?? getStripe(),
      now: deps.now ?? new Date(),
      jobs: deps.jobs,
    });
  }
  return { status: (await myChange(db, changeId, actor.customerId))!.status };
}
