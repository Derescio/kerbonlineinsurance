import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Alert } from "#/components/feedback/Alert";
import { formatPounds } from "#/features/rating/money";
import type { Purchase } from "#/server/data/quotes";

import { clearJourney, readJourney } from "./journey-store";
import { tierName } from "./labels";
import { buyableProducts, type BuyableProductId } from "./products";
import { confirmCheckoutFn, getPurchaseFn } from "./server";

// You're covered (5.6, decision 9; screen 18, adapted to 5.4b's frame): the badge, the thanks, a
// card per policy bought from the quote, the payment line and the email line. "Your policy
// documents" and "View policy" wait for 6.2.
//
// Stripe's form returns here with its session id (5.6b, decisions 6 and 11). The page confirms the
// session, which fulfils it now rather than waiting on the webhook, then shows the purchase. While
// the payment is still settling it says so and confirms again every 2 seconds for 20 seconds,
// then leaves it to the email. A purchase that couldn't be completed was refunded, and says so.

/** How often You're covered looks for the purchase while the payment settles, and how many times */
export interface PollTiming {
  everyMs: number;
  attempts: number;
}
const POLL: PollTiming = { everyMs: 2000, attempts: 10 };

export const CONFIRMING = "Confirming your payment…";
export const STILL_CONFIRMING =
  "Your payment is being confirmed. We’ll email you when your policy is ready.";
export const REFUNDED = "We couldn’t complete this purchase, so we’ve refunded your payment.";

type Shown =
  | { kind: "purchase"; purchase: Purchase }
  | { kind: "confirming" }
  | { kind: "still_confirming" }
  | { kind: "refunded" };

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const formatDay = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
const whole = (pence: number) => formatPounds(pence).replace(".00", "");

/** "£458.40 paid annually · Visa ending 4242", or the monthly version (decision 9) */
export function paymentLine(purchase: Purchase): string {
  const card = `${purchase.card.brand} ending ${purchase.card.last4}`;
  if (purchase.plan === "monthly") {
    const each = purchase.monthlyPaymentPence ?? purchase.firstPaymentPence;
    return `${formatPounds(purchase.firstPaymentPence)} paid today, then 11 monthly payments of ${formatPounds(each)} · ${card}`;
  }
  return `${formatPounds(purchase.firstPaymentPence)} paid annually · ${card}`;
}

export function CoveredPage({
  quoteId,
  purchase,
  sessionId,
  poll = POLL,
}: {
  quoteId: string;
  /** The bought purchase; null on the way back from Stripe's form, until it's confirmed */
  purchase: Purchase | null;
  /** Stripe's Checkout Session id, on the way back from its form */
  sessionId?: string;
  poll?: PollTiming;
}) {
  const shown = useConfirmedPurchase(quoteId, purchase, sessionId, poll);
  // Before the purchase is read, the tab that saved this quote says which product it is (5.7)
  const [product, setProduct] = useState<BuyableProductId>("car");
  useEffect(() => setProduct(productOfQuote(quoteId)), [quoteId]);
  if (shown.kind === "purchase") return <Bought purchase={shown.purchase} />;
  if (shown.kind === "refunded") {
    return (
      <div className="quote-page quote-covered">
        <header className="quote-heading">
          <p className="quote-heading__overline">{productLabel(product)} insurance · Purchase</p>
          <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
            We&rsquo;ve refunded your payment
          </h1>
        </header>
        <div className="quote-covered__body">
          <Alert tone="warning">
            <p>{REFUNDED}</p>
            <Link to="/quote/retrieve" className="quote-link">
              My quotes
            </Link>
          </Alert>
        </div>
      </div>
    );
  }
  return (
    <div className="quote-page quote-covered">
      <header className="quote-heading">
        <p className="quote-heading__overline">{productLabel(product)} insurance · Purchase</p>
        <h1 className="kb-h1 quote-heading__title quote-covered__wait" tabIndex={-1}>
          {shown.kind === "confirming" ? <span className="kb-spinner" aria-hidden="true" /> : null}
          {CONFIRMING}
        </h1>
      </header>
      <div className="quote-covered__body" role="status">
        {shown.kind === "still_confirming" ? (
          <>
            <p>{STILL_CONFIRMING}</p>
            <div>
              <Link to="/account" className="kb-btn kb-btn--primary kb-btn--lg">
                Go to my account
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the page shows: the purchase given, or, with Stripe's session id, what confirming it found.
 * The confirm and its polls start once however often React runs the effect, and stop when the page
 * goes away.
 */
function useConfirmedPurchase(
  quoteId: string,
  given: Purchase | null,
  sessionId: string | undefined,
  poll: PollTiming,
): Shown {
  const [shown, setShown] = useState<Shown>({ kind: "confirming" });
  const started = useRef(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!sessionId || started.current) return;
    started.current = true;
    const session = sessionId;

    /** Shows the purchase if it's there yet: it isn't found until the quote is bought */
    async function load(): Promise<boolean> {
      try {
        const purchase = await getPurchaseFn({ data: { quoteId } });
        if (!alive.current) return true;
        // Bought: the tab's journey for this quote is done (5.6, decision 9), and a bundle's car
        // with it, named by the home's mark (5.7b)
        const bundledCar =
          readJourney("home")?.saved?.quoteId === quoteId
            ? readJourney("home")?.bundle?.carJourneyId
            : undefined;
        for (const product of buyableProducts) {
          if (readJourney(product)?.saved?.quoteId === quoteId) clearJourney(product);
        }
        if (bundledCar && readJourney("car")?.journeyId === bundledCar) clearJourney("car");
        setShown({ kind: "purchase", purchase });
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Confirms the session and shows what that found; true when there's nothing more to wait for.
     * Confirming is idempotent (fulfilCheckout once per session, whoever asks), so each poll asks
     * again: a payment still settling at the first try is fulfilled from here once Stripe has it,
     * with no webhook needed (a preview Stripe can't reach).
     */
    async function confirmOnce(): Promise<boolean> {
      let status: string;
      try {
        ({ status } = await confirmCheckoutFn({ data: { quoteId, sessionId: session } }));
      } catch {
        // Not confirmed from here this time; the webhook may have fulfilled it, so look
        status = "error";
      }
      if (!alive.current) return true;
      if (status === "refunded") {
        setShown({ kind: "refunded" });
        return true;
      }
      if (status === "fulfilled" || status === "already" || status === "error") return load();
      return false;
    }

    function retry(attempt: number) {
      timer.current = setTimeout(() => {
        void (async () => {
          if (!alive.current || (await confirmOnce()) || !alive.current) return;
          if (attempt >= poll.attempts) setShown({ kind: "still_confirming" });
          else retry(attempt + 1);
        })();
      }, poll.everyMs);
    }

    void (async () => {
      if ((await confirmOnce()) || !alive.current) return;
      retry(1);
    })();
  }, [quoteId, sessionId, poll]);

  if (!sessionId && given) return { kind: "purchase", purchase: given };
  return shown;
}

/** The product whose tab journey saved this quote; car when neither did */
function productOfQuote(quoteId: string): BuyableProductId {
  return readJourney("home")?.saved?.quoteId === quoteId ? "home" : "car";
}

const productLabel = (product: string) => (product === "home" ? "Home" : "Car");

function Bought({ purchase }: { purchase: Purchase }) {
  const first = purchase.policies[0];
  const bundle = purchase.policies.length > 1;
  const tier = tierName(first?.coverLevel ?? null);
  const product = first?.product ?? "car";
  return (
    <div className="quote-page quote-covered">
      <header className="quote-heading">
        <Badge tone="success" dot>
          Payment successful
        </Badge>
        <p className="quote-heading__overline">
          {bundle ? "Car + home" : productLabel(product)} insurance · Purchase complete
        </p>
        <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
          You&rsquo;re covered
        </h1>
        <p className="quote-heading__intro">
          Thanks, {purchase.firstName}.{" "}
          {bundle
            ? "Your car and home insurance is confirmed."
            : `Your ${tier.toLowerCase()} ${product} insurance is confirmed.`}
        </p>
      </header>

      <div className="quote-covered__body">
        {purchase.policies.map((policy) => {
          const { car, home } = policy;
          const rows: [string, string][] = [
            ["Policy reference", policy.reference],
            ["Cover starts", formatDay(policy.startsOn)],
            ["Cover ends", formatDay(policy.endsOn)],
            [
              "Total excess",
              `${whole(policy.compulsoryExcessPence + policy.voluntaryExcessPence)} (${whole(
                policy.compulsoryExcessPence,
              )} compulsory + ${whole(policy.voluntaryExcessPence)} voluntary)`,
            ],
          ];
          return (
            <Card
              key={policy.reference}
              padding="lg"
              as="section"
              className="quote-paysum"
              aria-label={`Policy ${policy.reference}`}
            >
              <p className="quote-outcome__name">
                {car
                  ? `${car.make} ${car.model} ${car.variant}`
                  : home
                    ? `${home.addressLine1}, ${home.town}`
                    : tierName(policy.coverLevel)}
              </p>
              <p className="quote-outcome__meta">
                {[car?.registration, `${tierName(policy.coverLevel)} cover`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="quote-paysum__rows">
                {rows.map(([label, value]) => (
                  <div key={label} className="quote-paysum__row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}

        <p className="quote-covered__payment">{paymentLine(purchase)}</p>
        <p className="quote-note">
          A confirmation has been sent to {purchase.email}. You can also see your policy in your
          account.
        </p>
        <div className="quote-outcome__actions">
          <Link to="/account" className="kb-btn kb-btn--primary kb-btn--lg">
            Go to my account
          </Link>
          {purchase.policies.map((policy) => (
            <Link
              key={policy.reference}
              to="/account/policies/$reference"
              params={{ reference: policy.reference }}
              className="kb-btn kb-btn--secondary kb-btn--lg"
            >
              {bundle
                ? `View your ${productLabel(policy.product).toLowerCase()} policy`
                : "View your policy"}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
