import type Stripe from "stripe";

import { logSafeError } from "#/server/auth/errors";
import { checkoutDb, recordStripeEvent } from "#/server/data/checkout-rows";
import { jobsDb } from "#/server/data/job-rows";
import { withTx } from "#/server/db/tx";
import { jobDeps } from "#/server/jobs/deps";
import { runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";

import { kerbEnv } from "./kerb-env";
import type { StripeClient } from "./stripe";
import { entryFor, type HandlerDeps, type HandlerResult } from "./webhook-handlers";

// POST /api/webhooks/stripe (5.6b, decisions 2 and 7). In order:
// 1. The signature, checked against the raw body: a bad one is 400.
// 2. A type Kerb doesn't handle is 200 and ignored.
// 3. The object's kerb_env: another environment's event is 200 and ignored (one sandbox sends every
//    event to every endpoint); an untagged one too, with a warning.
// 4. The handler (webhook-handlers.ts), with the event recorded in stripe_events so a repeat does
//    nothing. A throw is 500, with nothing recorded, so Stripe retries; only the error's name is
//    logged, never the event's body.

export interface WebhookDeps {
  stripe: StripeClient;
  webhookSecret: string;
  now?: Date;
  /** The email runner's deps; tests hold the emails */
  jobs?: JobDeps;
}

const noStore = { "Cache-Control": "no-store" };
const ok = () => Response.json({ received: true }, { headers: noStore });

/** Sends a queued email after the commit; a failure is left for the cron's retry */
function sendSoon(jobId: number, jobs: JobDeps | undefined): void {
  try {
    runSoon(jobsDb(), jobId, jobs ?? jobDeps());
  } catch (error) {
    console.error("[stripe] queuing the email run failed:", logSafeError(error));
  }
}

export async function handleStripeWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (!deps.webhookSecret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set");
    return Response.json({ error: "not configured" }, { status: 503, headers: noStore });
  }

  // The signature covers the raw body, so read it as text before parsing
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(
      payload,
      request.headers.get("stripe-signature") ?? "",
      deps.webhookSecret,
    );
  } catch {
    return Response.json({ error: "bad signature" }, { status: 400, headers: noStore });
  }

  const entry = entryFor(event);
  if (!entry) return ok();

  const now = deps.now ?? new Date();
  const handlerDeps: HandlerDeps = { stripe: deps.stripe, now, jobs: deps.jobs };
  try {
    const tag = await entry.kerbEnv(event, handlerDeps);
    if (tag === null) {
      console.warn(`[stripe] ${event.type} ${event.id} has no kerb_env; ignored`);
      return ok();
    }
    if (tag !== kerbEnv()) return ok();

    let result: HandlerResult = {};
    if ("ownTransaction" in entry) {
      // fulfilCheckout's own transaction locks the checkout row; the event is recorded after
      await entry.ownTransaction(event, handlerDeps);
      await recordStripeEvent(checkoutDb(), event.id, event.type, now);
    } else {
      result = await withTx(checkoutDb(), async (tx) => {
        // The gate: a second delivery waits on the first's insert, then finds the id
        if (!(await recordStripeEvent(tx, event.id, event.type, now))) return {};
        return (await entry.handle(tx, event, handlerDeps)) ?? {};
      });
    }
    for (const jobId of result.emailJobs ?? []) sendSoon(jobId, deps.jobs);
    return ok();
  } catch (error) {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, logSafeError(error));
    return Response.json({ error: "failed" }, { status: 500, headers: noStore });
  }
}
