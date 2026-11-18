import {
  ACCOUNT_CLOSING,
  ALREADY_BOUGHT,
  NOT_BUYABLE,
  QUOTE_EXPIRED,
} from "#/features/quote/pay-copy";
import { paymentSchedule, policyEndDate } from "#/features/quote/policy-terms";
import { formatPounds } from "#/features/rating/money";
import { audit } from "#/server/audit/audit";
import type { Actor } from "#/server/auth/actor";
import { AuthzError } from "#/server/auth/errors";
import { authUrls } from "#/server/auth/origins";
import { getAccountState, lockUser } from "#/server/data/account";
import {
  acceptQuote,
  hasExpired,
  insertBundle,
  insertPayments,
  insertPolicy,
  lockCustomer,
  lockQuote,
  monthlyPaymentFor,
  purchaseItems,
  type LockedCustomer,
  type PurchaseItem,
} from "#/server/data/pay-quote";
import type { Tx } from "#/server/db/tx";
import { getAuthEnv } from "#/server/env";
import { queueEmail } from "#/server/jobs/email";

// Buying a saved quote (5.6, decision 7), moved out of 5.6's payForQuote so a Stripe checkout can
// rerun it once the payment is taken (5.6b, decision 6). One transaction, in the spec's order: lock
// the users and customer rows and check the account, lock the quote and check it, write the bundle
// and policies, the payments, the accepted quote, the audit rows and the email job. A failure rolls
// all of it back, and a second purchase waits on the quote's lock, then finds it accepted. The card
// is only ever Stripe's brand and last four.

export interface PurchaseInput {
  userId: string;
  customerId: string;
  quoteId: string;
  plan: "annual" | "monthly";
  startsOn: string;
  detailsConfirmedAt: Date;
  coverAcknowledgedAt: Date;
  card: { brand: string; last4: string };
  stripe: {
    paymentIntentId?: string;
    subscriptionId?: string;
    invoiceId?: string;
    /** Stripe's billing dates for a monthly plan, 12 of them; the cover start's months if absent */
    instalmentDates?: string[];
  };
  /** Null is the system (the webhook) */
  auditActor: Actor | null;
  now: Date;
  /** The checkout started before the quote expired, so it's honoured (5.6b, decision 6) */
  allowExpired?: boolean;
}

export type PurchaseResult =
  | { status: "bought"; quoteId: string; policyReferences: string[]; jobId: number }
  | { status: "refused"; message: string };

export type QuoteCheck =
  | { ok: false; message: string }
  | {
      ok: true;
      customer: LockedCustomer;
      quote: NonNullable<Awaited<ReturnType<typeof lockQuote>>>;
      items: PurchaseItem[];
    };

/**
 * 5.6's checks, writing nothing: the users and customer rows locked and an account that isn't
 * closing, then the quote locked, their own, not bought, in date (unless `allowExpired`) and
 * priced. A missing user, customer or quote throws, as 5.6 did. startCheckout runs the same checks.
 */
export async function checkQuote(
  tx: Tx,
  input: { userId: string; customerId: string; quoteId: string; now: Date; allowExpired?: boolean },
): Promise<QuoteCheck> {
  // The users row first, as deleteAccount and closure lock it, so they serialise without a
  // deadlock: a delete that waits on this then sees the policy and refuses (INSURANCE_RECORDS); a
  // purchase that waits on a delete finds the user gone. FOR NO KEY UPDATE, so a sign-in isn't
  // blocked.
  if (!(await lockUser(tx, input.userId, "write"))) throw new AuthzError("UNAUTHENTICATED");
  const customer = await lockCustomer(tx, input.customerId);
  if (!customer) throw new AuthzError("NOT_FOUND");
  if ((await getAccountState(tx, input.userId)).kind !== "active") {
    return { ok: false, message: ACCOUNT_CLOSING };
  }

  const quote = await lockQuote(tx, input.quoteId, customer.id);
  if (!quote) throw new AuthzError("NOT_FOUND");
  if (quote.status === "accepted") return { ok: false, message: ALREADY_BOUGHT };
  const expired = quote.status === "expired" || hasExpired(quote.validUntil, input.now);
  if (expired && !input.allowExpired) return { ok: false, message: QUOTE_EXPIRED };
  if (quote.status !== "priced" && !(quote.status === "expired" && input.allowExpired)) {
    return { ok: false, message: NOT_BUYABLE };
  }
  const items = await purchaseItems(tx, quote.id);
  if (items.length === 0) return { ok: false, message: NOT_BUYABLE };
  return { ok: true, customer, quote, items };
}

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

/** "18 Albion Road, LS6 2AB" for a home item, or "" (5.7b) */
function homeLine(items: PurchaseItem[]): string {
  const home = items.find((i) => i.home)?.home;
  return home ? `${home.addressLine1}, ${home.postcode}` : "";
}

function carLine(items: PurchaseItem[]): string {
  const car = items.find((i) => i.car)?.car;
  if (!car) return "";
  const name = `${car.make} ${car.model} ${car.variant}`;
  return car.registration ? `${name} · ${car.registration}` : name;
}

/**
 * Buys the quote inside `tx`. A refusal writes nothing; the caller sends the queued email
 * (`jobId`) after the commit, as 5.6 did.
 */
export async function purchase(tx: Tx, input: PurchaseInput): Promise<PurchaseResult> {
  const { now } = input;

  // 1 and 2. The user, customer and quote, locked and checked
  const checked = await checkQuote(tx, input);
  if (!checked.ok) return { status: "refused", message: checked.message };
  const { customer, quote, items } = checked;

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
        // The terms were agreed when the cover box was ticked
        termsAcceptedAt: input.coverAcknowledgedAt,
      }),
    );
  }

  // 5. The payments, from the saved total; the credit charge is the items' versions' (one rate,
  // checked). A monthly plan's due dates are Stripe's billing dates when given. Only
  // the first payment has an invoice and payment intent yet; every monthly row has the subscription.
  const monthly = await monthlyPaymentFor(
    tx,
    items.map((i) => i.ratingVersionId),
    quote.totalPence,
  );
  const schedule = paymentSchedule(input.plan, quote.totalPence, monthly, input.startsOn);
  const dates = input.plan === "monthly" ? input.stripe.instalmentDates : undefined;
  if (dates && dates.length !== schedule.length) {
    throw new Error(`Expected ${schedule.length} instalment dates, got ${dates.length}`);
  }
  await insertPayments(
    tx,
    schedule.map((row, i) => {
      const first = row.instalmentNumber === 1;
      return {
        customerId: customer.id,
        quoteId: quote.id,
        plan: input.plan,
        instalmentNumber: row.instalmentNumber,
        amountPence: row.amountPence,
        status: first ? "succeeded" : "scheduled",
        paidAt: first ? now : null,
        dueOn: dates?.[i] ?? row.dueOn,
        cardBrand: input.card.brand,
        cardLast4: input.card.last4,
        stripePaymentIntentId: first ? (input.stripe.paymentIntentId ?? null) : null,
        stripeInvoiceId: first ? (input.stripe.invoiceId ?? null) : null,
        stripeSubscriptionId: input.stripe.subscriptionId ?? null,
      };
    }),
  );

  // 6. The quote accepted, and each item starting on the chosen date (decision 8)
  await acceptQuote(tx, quote.id, {
    plan: input.plan,
    startsOn: input.startsOn,
    detailsConfirmedAt: input.detailsConfirmedAt,
    coverAcknowledgedAt: input.coverAcknowledgedAt,
  });

  // 7. An audit row per policy: the quote, plan and amount taken today, never the card
  const amountPence = schedule[0]!.amountPence;
  for (const policy of bought) {
    await audit(tx, {
      actor: input.auditActor,
      action: "policy.purchased",
      entityId: policy.id,
      changes: { quoteReference: quote.reference, plan: input.plan, amountPence },
    });
  }

  // 8. The confirmation email, through the outbox (decision 9)
  const jobId = await queueEmail(
    tx,
    {
      to: customer.email,
      template: "policy_confirmed",
      params: {
        name: customer.firstName,
        policyReference: bought.map((p) => p.reference).join(", "),
        car: carLine(items),
        home: homeLine(items),
        startsOn: formatDay(input.startsOn),
        endsOn: formatDay(endsOn),
        amount: amountLine(input.plan, amountPence, monthly),
        url: `${authUrls(getAuthEnv()).baseURL}/account`,
      },
    },
    now,
  );

  return {
    status: "bought",
    quoteId: quote.id,
    policyReferences: bought.map((p) => p.reference),
    jobId,
  };
}
