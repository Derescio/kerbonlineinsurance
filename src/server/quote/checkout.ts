import { z } from "zod";

import { tierName } from "#/features/quote/labels";
import { START_DATE_RANGE } from "#/features/quote/pay-copy";
import { startDateBounds } from "#/features/quote/policy-terms";
import { todayIso } from "#/features/quote/schemas/dates";
import type { WriteResult } from "#/lib/validation";
import type { Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import {
  insertCheckoutSession,
  markCheckout,
  openCheckoutFor,
  setStripeCustomerId,
} from "#/server/data/checkout-rows";
import { defineWrite, rejected, type DataWrite, type WriteEnvelope } from "#/server/data/define";
import { dropMultiPolicySaving, policyStillEarns } from "#/server/data/multi-policy-rows";
import { monthlyPaymentFor, type LockedCustomer, type PurchaseItem } from "#/server/data/pay-quote";
import { QUOTE_PAY_RULE } from "#/server/data/rate-limit-rules";
import type { Tx } from "#/server/db/tx";
import { getAuthEnv, getStripeEnv } from "#/server/env";
import { checkoutParams } from "#/server/payments/checkout-params";
import { expireAtStripe } from "#/server/payments/expire-session";
import { kerbEnv } from "#/server/payments/kerb-env";
import { getStripe, type StripeClient } from "#/server/payments/stripe";

import { checkQuote } from "./purchase";

// Starting a Stripe checkout for a saved quote (5.6b, decision 5), the browser's pay call in place
// of 5.6's payForQuote. It checks everything purchase() will (writing nothing to quotes or
// policies), finds or makes the customer's Stripe customer, expires the quote's open session so two
// tabs can't both pay, creates an embedded session and records it in checkout_sessions with the
// answers it was made for. The Stripe calls happen inside the write's transaction: if anything
// fails after the session is created, the row isn't written and the session expires unused.

export type StartCheckoutResult =
  | { status: "ready"; clientSecret: string; checkoutId: string }
  | { status: "repriced"; otherProduct: "car" | "home" };

/**
 * What a test swaps: the Stripe client (the fake in src/test/stripe-fake.ts), whether customers go
 * on test clocks, and the clock. Each defaults to the real environment.
 */
export interface CheckoutDeps {
  stripe?: StripeClient;
  testClocks?: boolean;
  now?: Date;
}

/** The input, with the start date checked against `today` */
function checkoutInput(today: string) {
  const bounds = startDateBounds(today);
  return z
    .object({
      quoteId: z.uuid(),
      plan: z.enum(["annual", "monthly"]),
      startsOn: z.iso.date(),
      detailsConfirmed: z.literal(true),
      coverAcknowledged: z.literal(true),
    })
    .superRefine((value, ctx) => {
      if (value.startsOn < bounds.min || value.startsOn > bounds.max) {
        ctx.addIssue({ code: "custom", path: ["startsOn"], message: START_DATE_RANGE });
      }
    });
}

type CheckoutInput = z.output<ReturnType<typeof checkoutInput>>;

/**
 * "Kerb car insurance, Comprehensive, KR24 BXL", or the make and model without a registration;
 * "Kerb home insurance, Comprehensive, 18 Albion Road" for a home (5.7); a bundle names both
 */
function lineName(items: PurchaseItem[]): string {
  const first = items[0]!;
  const carItem = items.find((i) => i.car);
  const homeItem = items.find((i) => i.home);
  const car = carItem?.car;
  // A bundle (5.7b): both covers, then the car and the address
  if (car && homeItem) {
    return [
      "Kerb car + home insurance",
      `${tierName(carItem!.coverLevel)} and ${tierName(homeItem.coverLevel)}`,
      `${car.registration ?? `${car.make} ${car.model}`} and ${homeItem.home!.addressLine1}`,
    ].join(", ");
  }
  if (!car && first.home) {
    return ["Kerb home insurance", tierName(first.coverLevel), first.home.addressLine1].join(", ");
  }
  const vehicle = car ? (car.registration ?? `${car.make} ${car.model}`) : null;
  return ["Kerb car insurance", tierName(first.coverLevel), vehicle].filter(Boolean).join(", ");
}

/**
 * The customer's Stripe customer: the one on file, or a new one with their name and email, tagged
 * with the environment. With test clocks on (decision 12), each gets its own clock, and one on file
 * without a clock is replaced by a clock-backed one.
 */
async function stripeCustomerFor(
  tx: Tx,
  customer: LockedCustomer,
  stripe: StripeClient,
  testClocks: boolean,
  now: Date,
): Promise<string> {
  if (customer.stripeCustomerId) {
    if (!testClocks) return customer.stripeCustomerId;
    const found = await stripe.customers.retrieve(customer.stripeCustomerId);
    if (!("deleted" in found && found.deleted) && found.test_clock) return found.id;
  }
  const clock = testClocks
    ? await stripe.testHelpers.testClocks.create({
        frozen_time: Math.floor(now.getTime() / 1000),
        name: `Kerb customer ${customer.id}`,
      })
    : null;
  const created = await stripe.customers.create({
    name: `${customer.firstName} ${customer.lastName}`.trim(),
    email: customer.email,
    metadata: { kerb_env: kerbEnv(), kerb_customer_id: customer.id },
    ...(clock ? { test_clock: clock.id } : {}),
  });
  await setStripeCustomerId(tx, customer.id, created.id);
  return created.id;
}

/** Expires the quote's open session, at Stripe and here, so only the new one can be paid */
async function expireOpenSession(
  tx: Tx,
  quoteId: string,
  stripe: StripeClient,
  now: Date,
): Promise<void> {
  const open = await openCheckoutFor(tx, quoteId);
  if (!open) return;
  // Stripe may have expired it already (its 30 minutes ran out): only the row is behind. A
  // completed session isn't safe to replace, so the start fails.
  if ((await expireAtStripe(stripe, open.stripeSessionId)) === "complete") {
    throw new Error("The quote's open checkout session has completed");
  }
  await markCheckout(tx, open.id, "expired", now);
}

/**
 * Starts a checkout for the signed-in customer's priced quote. defineWrite is built per call, so
 * the schema checks the start date against `now` and the run uses `deps`' Stripe client.
 */
async function start(
  actor: Actor | null,
  raw: WriteEnvelope,
  ctx: { headers: Headers },
  deps: CheckoutDeps = {},
): Promise<WriteResult<StartCheckoutResult>> {
  const now = deps.now ?? new Date();
  const write = defineWrite<CheckoutInput, StartCheckoutResult>(
    checkoutInput(todayIso(now)),
    {
      limit: { action: "quote.pay", rule: QUOTE_PAY_RULE },
      idempotent: { action: "quote.pay" },
    },
    async (actor, input, tx) => {
      // 1. Everything purchase() will check, without writing
      if (!actor.customerId) throw new AuthzError("NOT_FOUND");
      const checked = await checkQuote(tx, {
        userId: actor.userId,
        customerId: actor.customerId,
        quoteId: input.quoteId,
        now,
      });
      if (!checked.ok) return rejected(checked.message);
      const { customer, quote, items } = checked;
      // The earning policy is read again here, before any charge (6.1b, decision 5). If it no
      // longer qualifies, the quote is stored at the full price and nothing is sent to Stripe.
      if (
        quote.bundlePolicyId &&
        !(await policyStillEarns(tx, quote.bundlePolicyId, customer.id, now))
      ) {
        const otherProduct = await dropMultiPolicySaving(tx, quote.id);
        return { status: "repriced", otherProduct };
      }
      const amountPence =
        input.plan === "monthly"
          ? await monthlyPaymentFor(
              tx,
              items.map((i) => i.ratingVersionId),
              quote.totalPence,
            )
          : quote.totalPence;

      // 2 to 4. The Stripe customer, the previous session expired, the new session
      const stripe = deps.stripe ?? getStripe();
      const testClocks = deps.testClocks ?? getStripeEnv().testClocks;
      const stripeCustomerId = await stripeCustomerFor(tx, customer, stripe, testClocks, now);
      await expireOpenSession(tx, quote.id, stripe, now);
      const session = await stripe.checkout.sessions.create(
        checkoutParams({
          quoteId: quote.id,
          plan: input.plan,
          amountPence,
          lineName: lineName(items),
          stripeCustomerId,
          baseUrl: authUrls(getAuthEnv()).baseURL,
          now,
        }),
      );
      if (!session.client_secret) throw new Error("Stripe returned a session without a secret");

      // 5. The purchase being attempted, with the answers the session was made for
      const row = await insertCheckoutSession(tx, {
        quoteId: quote.id,
        customerId: customer.id,
        stripeSessionId: session.id,
        plan: input.plan,
        startsOn: input.startsOn,
        detailsConfirmedAt: now,
        coverAcknowledgedAt: now,
        amountPence,
      });
      return { status: "ready", clientSecret: session.client_secret, checkoutId: row.id };
    },
  );
  return write(actor, raw, ctx);
}

export const startCheckout: DataWrite<StartCheckoutResult> & typeof start = Object.assign(start, {
  access: "signed_in" as const,
  kind: "write" as const,
});
