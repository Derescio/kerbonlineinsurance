import { z } from "zod";

import { checkCard, DECLINED_TEST_CARD, type CardBrand } from "#/features/quote/card";
import {
  ACCOUNT_CLOSING,
  ALREADY_BOUGHT,
  CARD_DECLINED,
  NOT_BUYABLE,
  QUOTE_EXPIRED,
  START_DATE_RANGE,
} from "#/features/quote/pay-copy";
import { paymentSchedule, policyEndDate, startDateBounds } from "#/features/quote/policy-terms";
import { todayIso } from "#/features/quote/schemas/dates";
import { formatPounds } from "#/features/rating/money";
import type { WriteResult } from "#/lib/validation";
import { audit } from "#/server/audit/audit";
import type { Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import { getAccountState } from "#/server/data/account";
import {
  defineWrite,
  rejected,
  type DataWrite,
  type Rejected,
  type WriteEnvelope,
} from "#/server/data/define";
import {
  acceptQuote,
  insertBundle,
  insertPayments,
  insertPolicy,
  lockCustomer,
  lockQuote,
  monthlyPaymentFor,
  purchaseItems,
  type PurchaseItem,
} from "#/server/data/pay-quote";
import { jobsDb } from "#/server/data/job-rows";
import { QUOTE_PAY_RULE } from "#/server/data/rate-limit-rules";
import { getAuthEnv } from "#/server/env";
import { jobDeps } from "#/server/jobs/deps";
import { queueEmail, runSoon } from "#/server/jobs/email";
import type { JobDeps } from "#/server/jobs/types";

import { STAFF_CANT_BUY } from "./save";

// Paying for a saved quote (5.6, decision 7). The card is checked in the input schema and only its
// brand and last four survive the parse (ruling 1), so the idempotency hash, the payment rows, the
// audit row and the email never see the number or the code. A declined demo card is refused
// before anything is written. Then one transaction, in the spec's order: lock the customer and
// check the account, lock the quote and check it, write the bundle and policies, the payments,
// the accepted quote, the audit rows and the email job. Any failure rolls all of it back, and a
// second payment from another tab waits on the quote's lock and then finds it accepted.

export {
  ACCOUNT_CLOSING,
  ALREADY_BOUGHT,
  CARD_DECLINED,
  NOT_BUYABLE,
  QUOTE_EXPIRED,
  START_DATE_RANGE,
};

export type PayResult = { quoteId: string; policyReferences: string[] };

const cardInput = z.object({
  name: z.string(),
  number: z.string(),
  expiry: z.string(),
  code: z.string(),
});

/** The input, checked against `today`; the card comes out as brand, last four and declined */
function payInput(today: string) {
  const bounds = startDateBounds(today);
  return z
    .object({
      quoteId: z.uuid(),
      plan: z.enum(["annual", "monthly"]),
      startsOn: z.iso.date(),
      card: cardInput,
      detailsConfirmed: z.literal(true),
      coverAcknowledged: z.literal(true),
    })
    .superRefine((value, ctx) => {
      const card = checkCard(value.card, today);
      if (!card.ok) {
        for (const [field, message] of Object.entries(card.fields)) {
          ctx.addIssue({ code: "custom", path: ["card", field], message });
        }
      }
      if (value.startsOn < bounds.min || value.startsOn > bounds.max) {
        ctx.addIssue({ code: "custom", path: ["startsOn"], message: START_DATE_RANGE });
      }
    })
    .transform(({ card, ...rest }) => {
      // The refinement passed, so the card checks out
      const checked = checkCard(card, today) as { ok: true; brand: CardBrand; last4: string };
      const declined = card.number.replace(/\s/g, "") === DECLINED_TEST_CARD;
      return { ...rest, card: { brand: checked.brand, last4: checked.last4, declined } };
    });
}

type PayInput = z.output<ReturnType<typeof payInput>>;

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "20 November 2026" from "2026-11-20" */
const formatDay = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));

/** The email's payment line, as You're covered words it (decision 9), without the card */
function amountLine(plan: "annual" | "monthly", firstPence: number, eachPence: number): string {
  return plan === "annual"
    ? `${formatPounds(firstPence)} paid annually`
    : `${formatPounds(firstPence)} paid today, then 11 monthly payments of ${formatPounds(eachPence)}`;
}

function carLine(items: PurchaseItem[]): string {
  const car = items.find((i) => i.car)?.car;
  if (!car) return "";
  const name = `${car.make} ${car.model} ${car.variant}`;
  return car.registration ? `${name} · ${car.registration}` : name;
}

export type PayDeps = JobDeps & { now?: Date };

/**
 * Pays for the signed-in customer's priced quote. `deps` sends the email after the commit, as the
 * account emails do, and lets a test fix the clock. defineWrite is built per call, so `run` can
 * pass the queued email's id out, and the schema checks the card and dates against today.
 */
async function pay(
  actor: Actor | null,
  raw: WriteEnvelope,
  ctx: { headers: Headers },
  deps: PayDeps = jobDeps(),
): Promise<WriteResult<PayResult>> {
  const { now = new Date(), ...jobs } = deps;
  const done: { jobId?: number } = {};
  const write = defineWrite(
    payInput(todayIso(now)),
    {
      limit: { action: "quote.pay", rule: QUOTE_PAY_RULE },
      idempotent: { action: "quote.pay" },
    },
    async (actor, input: PayInput, tx): Promise<PayResult | Rejected> => {
      if (actor.staff) return rejected(STAFF_CANT_BUY);
      if (input.card.declined) return rejected(CARD_DECLINED, { "card.number": CARD_DECLINED });

      // 1. The customer, locked, and an account that isn't closing
      if (!actor.customerId) throw new AuthzError("NOT_FOUND");
      const customer = await lockCustomer(tx, actor.customerId);
      if (!customer) throw new AuthzError("NOT_FOUND");
      if ((await getAccountState(tx, actor.userId)).kind !== "active") {
        return rejected(ACCOUNT_CLOSING);
      }

      // 2. The quote, locked: their own, not bought, in date and priced
      const quote = await lockQuote(tx, input.quoteId, customer.id);
      if (!quote) throw new AuthzError("NOT_FOUND");
      if (quote.status === "accepted") return rejected(ALREADY_BOUGHT);
      if (quote.status === "expired" || quote.validUntil <= now) return rejected(QUOTE_EXPIRED);
      if (quote.status !== "priced") return rejected(NOT_BUYABLE);
      const items = await purchaseItems(tx, quote.id);
      if (items.length === 0) return rejected(NOT_BUYABLE);

      // 3 and 4. A bundle first when there's more than one item, then a policy per item
      const bundleId = items.length > 1 ? await insertBundle(tx, customer.id, quote.id) : null;
      const endsOn = policyEndDate(input.startsOn);
      const bought: { id: string; reference: string }[] = [];
      for (const item of items) {
        bought.push(
          await insertPolicy(tx, {
            customerId: customer.id,
            quoteId: quote.id,
            quoteItemId: item.id,
            bundleId,
            product: item.product,
            coverLevel: item.coverLevel,
            startsOn: input.startsOn,
            endsOn,
            annualPremiumPence: item.annualPremiumPence,
            compulsoryExcessPence: item.compulsoryExcessPence,
            voluntaryExcessPence: item.voluntaryExcessPence,
            termsAcceptedAt: now,
          }),
        );
      }

      // 5. The payments, from the saved total; the credit charge is the first item's version's,
      // as priceQuote takes it
      const monthly = await monthlyPaymentFor(tx, items[0]!.ratingVersionId, quote.totalPence);
      const schedule = paymentSchedule(input.plan, quote.totalPence, monthly, input.startsOn);
      await insertPayments(
        tx,
        schedule.map((row) => ({
          customerId: customer.id,
          quoteId: quote.id,
          plan: input.plan,
          instalmentNumber: row.instalmentNumber,
          amountPence: row.amountPence,
          status: row.instalmentNumber === 1 ? "succeeded" : "scheduled",
          paidAt: row.instalmentNumber === 1 ? now : null,
          dueOn: row.dueOn,
          cardBrand: input.card.brand,
          cardLast4: input.card.last4,
        })),
      );

      // 6. The quote accepted, and each item starting on the chosen date (decision 8)
      await acceptQuote(tx, quote.id, { plan: input.plan, at: now, startsOn: input.startsOn });

      // 7. An audit row per policy: the quote, plan and amount taken today, never the card
      const amountPence = schedule[0]!.amountPence;
      for (const policy of bought) {
        await audit(tx, {
          actor,
          action: "policy.purchased",
          entityId: policy.id,
          changes: { quoteReference: quote.reference, plan: input.plan, amountPence },
        });
      }

      // 8. The confirmation email, through the outbox (decision 9)
      done.jobId = await queueEmail(
        tx,
        {
          to: customer.email,
          template: "policy_confirmed",
          params: {
            name: customer.firstName,
            policyReference: bought.map((p) => p.reference).join(", "),
            car: carLine(items),
            startsOn: formatDay(input.startsOn),
            endsOn: formatDay(endsOn),
            amount: amountLine(input.plan, amountPence, monthly),
            url: `${authUrls(getAuthEnv()).baseURL}/account`,
          },
        },
        now,
      );

      return { quoteId: quote.id, policyReferences: bought.map((p) => p.reference) };
    },
  );
  const result = await write(actor, raw, ctx);
  if (result.ok && done.jobId) runSoon(jobsDb(), done.jobId, jobs);
  return result;
}

export const payForQuote: DataWrite<PayResult> & typeof pay = Object.assign(pay, {
  access: "signed_in" as const,
  kind: "write" as const,
});
