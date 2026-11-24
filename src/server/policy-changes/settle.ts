import type { Tx } from "#/server/db/tx";
import type { StoredPolicy } from "#/server/data/policy-change-rows";
import type { StripeClient } from "#/server/payments/stripe";

import type { PricedChange } from "./price";

// Settling a confirmed change's difference in Stripe (6.3b, decision 5). Task 5 fills these in.

type Quoted = Extract<PricedChange, { outcome: "quoted" }>;

export interface SettleDeps {
  stripe: StripeClient;
  now: Date;
}

/** Annual increase: an embedded Checkout for the top-up; the change applies when it's paid */
export async function startTopUp(
  _tx: Tx,
  _changeId: string,
  _stored: StoredPolicy,
  _priced: Quoted,
  _deps: SettleDeps,
): Promise<{ clientSecret: string }> {
  throw new Error("startTopUp: not built yet");
}

/** After an applied change: the refund (annual) or the new instalments (monthly) */
export async function settleApplied(
  _tx: Tx,
  _changeId: string,
  _stored: StoredPolicy,
  _priced: Quoted,
  _deps: SettleDeps,
): Promise<void> {
  // Task 5
}
