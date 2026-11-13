import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { formatPounds } from "#/features/rating/money";
import type { Purchase } from "#/server/data/quotes";

import { tierName } from "./labels";

// You're covered (5.6, decision 9; screen 18, adapted to 5.4b's frame): the badge, the thanks, a
// card per policy bought from the quote, the payment line and the email line. "Your policy
// documents" and "View policy" wait for 6.2.

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

export function CoveredPage({ purchase }: { purchase: Purchase }) {
  const first = purchase.policies[0];
  const tier = tierName(first?.coverLevel ?? null);
  return (
    <div className="quote-page quote-covered">
      <header className="quote-heading">
        <Badge tone="success" dot>
          Payment successful
        </Badge>
        <p className="quote-heading__overline">Car insurance · Purchase complete</p>
        <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
          You&rsquo;re covered
        </h1>
        <p className="quote-heading__intro">
          Thanks, {purchase.firstName}. Your {tier.toLowerCase()} car insurance is confirmed.
        </p>
      </header>

      <div className="quote-covered__body">
        {purchase.policies.map((policy) => {
          const car = policy.car;
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
                {car ? `${car.make} ${car.model} ${car.variant}` : tierName(policy.coverLevel)}
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
        <div>
          <Link to="/account" className="kb-btn kb-btn--primary kb-btn--lg">
            Go to my account
          </Link>
        </div>
      </div>
    </div>
  );
}
