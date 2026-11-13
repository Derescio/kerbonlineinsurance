import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { FieldMessage } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";
import { formatPounds } from "#/features/rating/money";
import { focusFirstError } from "#/lib/validation";
import { useIdempotencyKey, writeOutcome } from "#/lib/writes";
import type { PaymentSummary } from "#/server/data/quotes";

import { checkCard } from "./card";
import { clearJourney, readJourney, type Payment } from "./journey-store";
import { tierName } from "./labels";
import { JourneyPage, StepNav } from "./page-kit";
import { ALREADY_BOUGHT, NOT_BUYABLE, QUOTE_EXPIRED, START_DATE_RANGE } from "./pay-copy";
import { PayChoice } from "./PayChoice";
import { startDateBounds } from "./policy-terms";
import { todayIso } from "./schemas/dates";
import { payFn } from "./server";
import { StepHeading } from "./step-kit";

// Confirm and pay (5.6, decision 6; the Purchase frame, 157:11256, in 5.4b's frame). It reads the
// saved quote, never the tab, so it works from Your saved quotes too; the tab only says which plan
// to start on and where Back goes. The card is checked here and again on the server, which keeps
// nothing of it but the brand and last four. A paid quote clears the tab's car journey (decision 9).

type Errors = Record<string, string | undefined>;

interface CardForm {
  name: string;
  number: string;
  expiry: string;
  code: string;
}

/** The server's field paths this form has a place for */
const FORM_FIELDS = [
  "startsOn",
  "card.name",
  "card.number",
  "card.expiry",
  "card.code",
  "detailsConfirmed",
  "coverAcknowledged",
];

const whole = (pence: number) => formatPounds(pence).replace(".00", "");

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "20 Nov 2026" from "2026-11-20"; an empty or unfinished date shows as it is */
const formatDay = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DATE.format(new Date(`${iso}T00:00:00Z`)) : iso;

/** The tab's car journey, when it still holds this quote (read after hydration) */
function useTabJourney(quoteId: string) {
  const [tab, setTab] = useState<{ postcode: string; payment?: Payment } | null>(null);
  useEffect(() => {
    const journey = readJourney("car");
    if (journey?.saved?.quoteId === quoteId) {
      setTab({ postcode: journey.postcode, payment: journey.payment });
    }
  }, [quoteId]);
  return tab;
}

export function PayPage({ summary }: { summary: PaymentSummary }) {
  const navigate = useNavigate();
  const tab = useTabJourney(summary.quoteId);

  // "Back to choose cover" (decision 6): Choose cover when the tab still holds this quote,
  // otherwise Your saved quotes, where it came from
  const back = () => {
    if (tab) void navigate({ to: "/quote/car", search: { postcode: tab.postcode, step: "cover" } });
    else void navigate({ to: "/quote/retrieve" });
  };

  const heading = (
    <StepHeading
      overline="Car insurance / Buy"
      title="Confirm and pay"
      intro="Review your payment details, check your cover and complete the purchase."
    />
  );

  // The server refuses these too; the page says so up front and offers no form
  const stop = summary.expired ? QUOTE_EXPIRED : summary.status !== "priced" ? NOT_BUYABLE : null;
  if (stop) {
    return (
      <JourneyPage heading={heading} aside={<CoverSummary summary={summary} />}>
        <Alert tone="warning">
          <p>{stop}</p>
          {summary.expired ? (
            <a href="/quote?type=car" className="quote-link">
              Get a new quote
            </a>
          ) : null}
        </Alert>
        <StepNav onBack={back} backLabel="Back to choose cover" />
      </JourneyPage>
    );
  }

  return <PayForm summary={summary} heading={heading} tab={tab} onBack={back} />;
}

function PayForm({
  summary,
  heading,
  tab,
  onBack,
}: {
  summary: PaymentSummary;
  heading: ReactNode;
  tab: { payment?: Payment } | null;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [today] = useState(todayIso);
  const bounds = startDateBounds(today);
  const [plan, setPlan] = useState<Payment>("annual");
  const [startsOn, setStartsOn] = useState(bounds.fallback);
  const [card, setCard] = useState<CardForm>({
    name: `${summary.policyholder.firstName} ${summary.policyholder.lastName}`.trim(),
    number: "",
    expiry: "",
    code: "",
  });
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [coverAcknowledged, setCoverAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { key: idempotencyKey, rotate } = useIdempotencyKey(`quote.pay:${summary.quoteId}`);

  // Start on the plan the tab chose for this quote; annual from Your saved quotes (decision 6)
  const tabPayment = tab?.payment;
  useEffect(() => {
    if (tabPayment) setPlan(tabPayment);
  }, [tabPayment]);

  const amount =
    plan === "monthly"
      ? `Pay ${formatPounds(summary.monthlyPaymentPence)} today`
      : `Pay ${formatPounds(summary.annualTotalPence)}`;

  const setCardField = (key: keyof CardForm) => (e: { target: { value: string } }) =>
    setCard((current) => ({ ...current, [key]: e.target.value }));

  function check(): Errors {
    const found: Errors = {};
    if (!startsOn || startsOn < bounds.min || startsOn > bounds.max) {
      found.startsOn = START_DATE_RANGE;
    }
    const checked = checkCard(card, today);
    if (!checked.ok) {
      for (const [name, message] of Object.entries(checked.fields)) found[`card.${name}`] = message;
    }
    if (!detailsConfirmed) found.detailsConfirmed = "Confirm your details are correct.";
    if (!coverAcknowledged) found.coverAcknowledged = "Agree to the policy terms to continue.";
    return found;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (paying) return;
    setFailure(null);
    const found = check();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(formRef.current);
      return;
    }
    setPaying(true);
    try {
      const result = await payFn({
        data: {
          input: {
            quoteId: summary.quoteId,
            plan,
            startsOn,
            card,
            detailsConfirmed: true,
            coverAcknowledged: true,
          },
          idempotencyKey,
        },
      });
      if (!result.ok) {
        setPaying(false);
        const fields = result.error.fields;
        // A field the form shows (a declined card is on the number); anything else under the button
        if (Object.keys(fields).some((name) => FORM_FIELDS.includes(name))) {
          setErrors(fields);
          focusFirstError(formRef.current);
        } else {
          setFailure(result.error.message);
        }
        return;
      }
      // The key's write is done, and the tab forgets the journey (decision 9)
      rotate();
      clearJourney("car");
      void navigate({
        to: "/quote/covered/$quoteId",
        params: { quoteId: result.data.quoteId },
        replace: true,
      });
    } catch (thrown) {
      setPaying(false);
      const outcome = writeOutcome(thrown);
      if (outcome.kind === "sign_in") {
        void navigate({ to: "/login", search: { redirect: location.href } });
        return;
      }
      if (outcome.rotateKey) rotate();
      setFailure(outcome.message);
    }
  }

  return (
    <JourneyPage
      heading={heading}
      aside={<CoverSummary summary={summary} plan={plan} startsOn={startsOn} />}
    >
      <form ref={formRef} noValidate onSubmit={submit} className="quote-form">
        <section className="quote-panel" aria-labelledby="pay-start-heading">
          <h2 id="pay-start-heading" className="kb-h3 quote-panel__title">
            Cover start date
          </h2>
          <Input
            type="date"
            label="When should your cover start?"
            hint="From today up to 30 days ahead."
            min={bounds.min}
            max={bounds.max}
            value={startsOn}
            error={errors.startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </section>

        <section className="quote-panel" aria-label="How would you like to pay?">
          <PayChoice
            legend="How would you like to pay?"
            annualPence={summary.annualTotalPence}
            monthlyPaymentPence={summary.monthlyPaymentPence}
            value={plan}
            onChange={setPlan}
          />
        </section>

        <section className="quote-panel" aria-labelledby="pay-card-heading">
          <h2 id="pay-card-heading" className="kb-h3 quote-panel__title">
            Payment card
          </h2>
          <Input
            label="Name on card"
            autoComplete="cc-name"
            value={card.name}
            error={errors["card.name"]}
            onChange={setCardField("name")}
          />
          <Input
            label="Card number"
            autoComplete="cc-number"
            inputMode="numeric"
            maxLength={23}
            value={card.number}
            error={errors["card.number"]}
            onChange={setCardField("number")}
          />
          <div className="quote-fields">
            <Input
              label="Expiry (MM / YY)"
              autoComplete="cc-exp"
              inputMode="numeric"
              maxLength={7}
              value={card.expiry}
              error={errors["card.expiry"]}
              onChange={setCardField("expiry")}
            />
            <Input
              label="Security code"
              autoComplete="cc-csc"
              inputMode="numeric"
              maxLength={4}
              value={card.code}
              error={errors["card.code"]}
              onChange={setCardField("code")}
            />
          </div>
          <p className="quote-note">
            Demo cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.
          </p>
        </section>

        <section className="quote-panel" aria-label="Confirm">
          <div className="quote-confirm">
            <Checkbox
              label="I confirm my details are correct"
              checked={detailsConfirmed}
              aria-invalid={errors.detailsConfirmed ? true : undefined}
              aria-describedby={errors.detailsConfirmed ? "pay-details-error" : undefined}
              onChange={(e) => setDetailsConfirmed(e.target.checked)}
            />
            <FieldMessage id="pay-details" error={errors.detailsConfirmed} />
          </div>
          <div className="quote-confirm">
            <Checkbox
              label="I agree to the policy terms and understand my cover"
              checked={coverAcknowledged}
              aria-invalid={errors.coverAcknowledged ? true : undefined}
              aria-describedby={errors.coverAcknowledged ? "pay-terms-error" : undefined}
              onChange={(e) => setCoverAcknowledged(e.target.checked)}
            />
            <FieldMessage id="pay-terms" error={errors.coverAcknowledged} />
          </div>
        </section>

        <div className="quote-pay-submit">
          <StepNav
            onBack={onBack}
            backLabel="Back to choose cover"
            next={
              <Button type="submit" variant="primary" size="lg" loading={paying}>
                {amount}
              </Button>
            }
          />
          {failure ? (
            <Alert tone="warning" announce>
              <p>{failure}</p>
              {failure === ALREADY_BOUGHT ? (
                <Link
                  to="/quote/covered/$quoteId"
                  params={{ quoteId: summary.quoteId }}
                  className="quote-link"
                >
                  Go to You&rsquo;re covered
                </Link>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </form>
    </JourneyPage>
  );
}

/** The summary card, as drawn: the tier and "Selected", then the quote's details and the payment */
function CoverSummary({
  summary,
  plan = "annual",
  startsOn,
}: {
  summary: PaymentSummary;
  plan?: Payment;
  startsOn?: string;
}) {
  const { car, policyholder } = summary;
  const rows: [string, string][] = [
    ["Policyholder", `${policyholder.firstName} ${policyholder.lastName}`],
    [
      "Vehicle",
      [`${car.make} ${car.model} ${car.variant}`, car.registration].filter(Boolean).join(" · "),
    ],
    ["Total excess", whole(summary.compulsoryExcessPence + summary.voluntaryExcessPence)],
    ...(startsOn ? [["Cover starts", formatDay(startsOn)] as [string, string]] : []),
    plan === "monthly"
      ? ["Monthly payment", `12 payments of ${formatPounds(summary.monthlyPaymentPence)}`]
      : ["Annual payment", formatPounds(summary.annualTotalPence)],
  ];
  return (
    <Card padding="lg" as="section" className="quote-paysum" aria-labelledby="paysum-heading">
      <div className="quote-paysum__head">
        <h2 id="paysum-heading" className="kb-h4">
          {tierName(summary.coverLevel)}
        </h2>
        <Badge tone="success">Selected</Badge>
      </div>
      <dl className="quote-paysum__rows">
        {rows.map(([label, value]) => (
          <div key={label} className="quote-paysum__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="quote-outcome__small">Insurance Premium Tax (IPT) included.</p>
    </Card>
  );
}
