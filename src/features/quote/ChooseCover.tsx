import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { Select } from "#/components/forms/Select";
import { CoverageGroup } from "#/components/insurance/CoverageGroup";
import { formatPounds } from "#/features/rating/money";
import { coverLevels, type CoverLevel } from "#/server/db/schema/values";
import type { CarPriceResult } from "#/server/quote/price";

import {
  addonCopy,
  addonWithIpt,
  composeCover,
  FEATURES,
  monthlyTerms,
  TIERS,
  usableCover,
  VOLUNTARY_EXCESS_PENCE,
  type ComposedCover,
  type CoverPrices,
} from "./cover";
import {
  DEFAULT_COVER,
  setPayment,
  type CoverChoice,
  type Journey,
  type Payment,
} from "./journey-store";
import { JourneyPage, StepNav } from "./page-kit";
import { PayChoice } from "./PayChoice";
import { priceQuery } from "./price-query";
import { StepHeading } from "./step-kit";
import type { DriverStep } from "./steps";

// Choose cover (5.5; screen 13, 226:699, in 5.4b's frame): the voluntary excess, the three levels as
// cards and a comparison table, the extras, how to pay, and the price breakdown. The server prices
// every level once per excess; any tier, extras and payment are composed here with no server call
// (decision 6). Only a quoted journey can be here: anything else goes back to Your quote.

const excessOptions = VOLUNTARY_EXCESS_PENCE.map((pence) => ({
  value: String(pence),
  label: formatPounds(pence).replace(".00", ""),
}));

const whole = (pence: number) => formatPounds(pence).replace(".00", "");

/** What Choose cover and the home offer need when they move the visitor on */
export interface CoverMoves {
  /** Saves the choice in the tab; the journey comes back with it */
  onCover: (cover: CoverChoice) => void;
  /** Referred or declined: Your quote shows why */
  onNotQuoted: () => void;
  /** Where the server sends a step that no longer passes */
  onInvalid: (step: "car" | DriverStep) => void;
}

/**
 * The price at the chosen excess, guarding the step: only a quoted journey stays (decision 2). An
 * excess that isn't offered goes back to £0; a level referred at this excess, or an extra no longer
 * offered, drops out of the choice.
 */
export function useCoverPrice(journey: Journey, handlers: CoverMoves) {
  // The last excess's prices stay while the next one is fetched, so the page doesn't blank out
  const query = useQuery({ ...priceQuery(journey), placeholderData: keepPreviousData });
  const result = query.data;
  const cover = journey.cover ?? DEFAULT_COVER;

  // Once per answer: a new callback each render must not send the visitor twice
  const handled = useRef<CarPriceResult | null>(null);
  const moves = useRef(handlers);
  useEffect(() => {
    moves.current = handlers;
  });
  useEffect(() => {
    if (!result || query.isPlaceholderData || handled.current === result) return;
    handled.current = result;
    if (result.status === "invalid") {
      if (result.step === "cover") moves.current.onCover({ ...cover, voluntaryExcessPence: 0 });
      else moves.current.onInvalid(result.step);
    } else if (result.status === "referred" || result.status === "declined") {
      moves.current.onNotQuoted();
    } else if (result.status === "quoted") {
      const usable = usableCover(result, cover);
      if (JSON.stringify(usable) !== JSON.stringify(cover)) moves.current.onCover(usable);
    }
  }, [result, query.isPlaceholderData, cover]);

  return { query, result, cover };
}

export function ChooseCover({
  journey,
  aside,
  onCover,
  onBack,
  onContinue,
  onNotQuoted,
  onInvalid,
}: {
  journey: Journey;
  aside: ReactNode;
  onBack: () => void;
  onContinue: () => void;
} & CoverMoves) {
  const { query, result, cover } = useCoverPrice(journey, { onCover, onNotQuoted, onInvalid });
  const [payment, setPaymentState] = useState<Payment>(journey.payment ?? "annual");

  const heading = (
    <StepHeading
      overline="Car insurance / Choose cover"
      title="Compare your cover, side by side"
      intro={
        journey.vehicle
          ? `Choose a level of protection for your ${journey.vehicle.make} ${journey.vehicle.model}, and compare the same benefits across all three levels.`
          : undefined
      }
    />
  );

  if (query.isError && !result) {
    return (
      <JourneyPage heading={heading} aside={aside}>
        <Alert tone="warning" announce>
          <p>We couldn&rsquo;t work out your price just now.</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Alert>
        <StepNav onBack={onBack} backLabel="Back to your quote" />
      </JourneyPage>
    );
  }

  if (result?.status !== "quoted") {
    return (
      <JourneyPage heading={heading} aside={aside}>
        <Card padding="lg" className="quote-slot">
          <p role="status">
            {result?.status === "rate_limited"
              ? "You’ve asked for a lot of prices in a short time. Try again in an hour."
              : "Working out your price…"}
          </p>
        </Card>
        <StepNav onBack={onBack} backLabel="Back to your quote" />
      </JourneyPage>
    );
  }

  const chosen = usableCover(result, cover);
  const composed = composeCover(result, chosen.coverLevel, chosen.addons)!;
  const name = TIERS[chosen.coverLevel].name;

  const choose = (next: Partial<CoverChoice>) => onCover({ ...chosen, ...next });
  const choosePayment = (value: Payment) => {
    setPaymentState(value);
    setPayment("car", value);
  };

  return (
    <JourneyPage heading={heading} aside={aside}>
      <div className="quote-cover">
        <Card padding="lg" className="quote-cover__excess">
          <Select
            label="Voluntary excess"
            hint="What you agree to pay towards a claim on top of the compulsory excess. A higher amount lowers your price."
            options={excessOptions}
            value={String(cover.voluntaryExcessPence)}
            onChange={(e) => choose({ voluntaryExcessPence: Number(e.target.value) })}
          />
          {query.isPlaceholderData ? (
            <p className="quote-cover__updating">Updating your prices&hellip;</p>
          ) : null}
        </Card>

        <CoverLevels
          prices={result}
          addons={chosen.addons}
          payment={payment}
          value={chosen.coverLevel}
          onChange={(coverLevel) => choose({ coverLevel })}
        />

        <CompareTable
          prices={result}
          addons={chosen.addons}
          value={chosen.coverLevel}
          onChange={(coverLevel) => choose({ coverLevel })}
        />

        {result.addons.length ? (
          <Card padding="lg" as="section" className="quote-extras" aria-labelledby="extras-heading">
            <h2 id="extras-heading" className="kb-h3">
              Optional extras for {name}
            </h2>
            <div className="quote-extras__list">
              {result.addons.map((a) => {
                const copy = addonCopy(a.addon);
                const price = addonWithIpt(result, a.annualPricePence);
                return (
                  <Checkbox
                    key={a.addon}
                    label={`${copy.label} · ${
                      payment === "monthly"
                        ? `${formatPounds(price.monthlyPence)} a month`
                        : `${formatPounds(price.annualPence)} a year`
                    }`}
                    description={copy.description}
                    checked={chosen.addons.includes(a.addon)}
                    onChange={(e) =>
                      choose({
                        addons: e.target.checked
                          ? [...chosen.addons, a.addon]
                          : chosen.addons.filter((x) => x !== a.addon),
                      })
                    }
                  />
                );
              })}
            </div>
            <p role="status" className="quote-extras__total">
              {chosen.addons.length ? "" : "No extras selected. "}
              {name} total: {formatPounds(composed.totalPence)} a year or 12 payments of{" "}
              {formatPounds(composed.monthlyPaymentPence)}.
            </p>
          </Card>
        ) : null}

        <Card padding="lg">
          <PayChoice
            annualPence={composed.totalPence}
            monthlyPaymentPence={composed.monthlyPaymentPence}
            value={payment}
            onChange={choosePayment}
          />
        </Card>

        <Breakdown
          composed={composed}
          payment={payment}
          monthlyRate={result.monthlyCreditChargeRate}
          iptRate={result.iptRate}
        />
      </div>
      <StepNav
        onBack={onBack}
        backLabel="Back to your quote"
        next={
          <Button variant="accent" iconRight="arrow-right" onClick={onContinue}>
            Continue with {name}
          </Button>
        }
      />
    </JourneyPage>
  );
}

function totalExcess(prices: CoverPrices, level: CoverLevel): number {
  const tier = prices.levels.find((t) => t.coverLevel === level)!;
  return tier.compulsoryExcessPence + prices.voluntaryExcessPence;
}

/** The three cards: one radio group, a referred level shown but not choosable (decision 6) */
function CoverLevels({
  prices,
  addons,
  payment,
  value,
  onChange,
}: {
  prices: CoverPrices;
  addons: readonly string[];
  payment: Payment;
  value: CoverLevel;
  onChange: (level: CoverLevel) => void;
}) {
  const options = coverLevels.map((level) => {
    const composed = composeCover(prices, level, addons);
    const tier = TIERS[level];
    return {
      id: level,
      name: tier.name,
      description: composed ? tier.description : "We’d need to check this level",
      price: composed
        ? formatPounds(payment === "monthly" ? composed.monthlyPaymentPence : composed.totalPence)
        : undefined,
      period: payment === "monthly" ? "/month" : "/year",
      features: FEATURES.map((f) => ({ label: f.label, included: tier.includes[f.key] })),
      note: `Total excess ${whole(totalExcess(prices, level))}`,
      "aria-disabled": composed ? undefined : true,
    };
  });
  return (
    <CoverageGroup
      label="Cover level"
      className="quote-cover__levels"
      options={options}
      value={value}
      onChange={(id) => {
        const level = id as CoverLevel;
        if (composeCover(prices, level, addons)) onChange(level);
      }}
    />
  );
}

/** "What each level includes": hidden on a phone, where the cards carry the features (decision 13) */
function CompareTable({
  prices,
  addons,
  value,
  onChange,
}: {
  prices: CoverPrices;
  addons: readonly string[];
  value: CoverLevel;
  onChange: (level: CoverLevel) => void;
}) {
  const composed = Object.fromEntries(
    coverLevels.map((level) => [level, composeCover(prices, level, addons)]),
  ) as Record<CoverLevel, ComposedCover | null>;
  const cell = (level: CoverLevel, text: string) => (
    <td key={level} className={level === value ? "is-chosen" : undefined}>
      {text}
    </td>
  );
  const money = (level: CoverLevel, pick: (c: ComposedCover) => number) => {
    const c = composed[level];
    return cell(level, c ? formatPounds(pick(c)) : "We’d need to check");
  };
  return (
    <Card padding="lg" as="section" className="quote-compare" aria-labelledby="compare-heading">
      <h2 id="compare-heading" className="kb-h3">
        What each level includes
      </h2>
      <table className="quote-compare__table">
        <thead>
          <tr>
            <th scope="col">Feature</th>
            {coverLevels.map((level) => (
              <th key={level} scope="col" className={level === value ? "is-chosen" : undefined}>
                <button
                  type="button"
                  className="quote-compare__choose"
                  aria-pressed={level === value}
                  disabled={!composed[level]}
                  onClick={() => onChange(level)}
                >
                  {TIERS[level].name}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Monthly payment</th>
            {coverLevels.map((level) => money(level, (c) => c.monthlyPaymentPence))}
          </tr>
          <tr>
            <th scope="row">Annual total</th>
            {coverLevels.map((level) => money(level, (c) => c.totalPence))}
          </tr>
          {FEATURES.map((f) => (
            <tr key={f.key}>
              <th scope="row">{f.label}</th>
              {coverLevels.map((level) =>
                cell(level, TIERS[level].includes[f.key] ? "Included" : "Not included"),
              )}
            </tr>
          ))}
          <tr>
            <th scope="row">Total excess</th>
            {coverLevels.map((level) => cell(level, whole(totalExcess(prices, level))))}
          </tr>
        </tbody>
      </table>
      <p className="quote-compare__note">
        Prices include Insurance Premium Tax and your chosen extras. Paying monthly is 12 payments
        and costs {Math.round(prices.monthlyCreditChargeRate * 100)}% more.
      </p>
    </Card>
  );
}

/** The price breakdown (decision 7): every line from quoteTotals(), adding up to the total */
function Breakdown({
  composed,
  payment,
  monthlyRate,
  iptRate,
}: {
  composed: ComposedCover;
  payment: Payment;
  monthlyRate: number;
  iptRate: number;
}) {
  const terms = monthlyTerms(composed);
  const percent = (rate: number) => `${Math.round(rate * 100)}%`;
  const lines: [string, string][] = [
    [`${TIERS[composed.coverLevel].name} cover`, formatPounds(composed.premiumPence)],
    ...composed.addons.map((a): [string, string] => [
      addonCopy(a.addon).label,
      formatPounds(a.annualPricePence),
    ]),
    ["Admin fees", composed.feePence ? formatPounds(composed.feePence) : "No admin fees"],
    [`Insurance Premium Tax (${percent(iptRate)})`, formatPounds(composed.iptPence)],
  ];
  return (
    <Card padding="lg" as="section" className="quote-breakdown" aria-labelledby="breakdown-heading">
      <h2 id="breakdown-heading" className="kb-h3">
        How your price is made up
      </h2>
      <p className="quote-breakdown__excess">
        Total excess {whole(composed.compulsoryExcessPence + composed.voluntaryExcessPence)}{" "}
        (compulsory {whole(composed.compulsoryExcessPence)} + voluntary{" "}
        {whole(composed.voluntaryExcessPence)})
      </p>
      <dl className="quote-breakdown__lines">
        {lines.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="quote-breakdown__total">
          <dt>Total if you pay annually</dt>
          <dd>{formatPounds(composed.totalPence)}</dd>
        </div>
        {payment === "monthly" ? (
          <>
            <div>
              <dt>Cost of paying monthly ({percent(monthlyRate)})</dt>
              <dd>{formatPounds(terms.costPence)}</dd>
            </div>
            <div>
              <dt>Total payable</dt>
              <dd>{formatPounds(terms.totalPayablePence)}</dd>
            </div>
            <div className="quote-breakdown__total">
              <dt>12 monthly payments of</dt>
              <dd>{formatPounds(terms.paymentPence)}</dd>
            </div>
            <div>
              <dt>Representative APR</dt>
              <dd>{terms.apr.toFixed(1)}%</dd>
            </div>
          </>
        ) : null}
      </dl>
    </Card>
  );
}
