import { useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { Input } from "#/components/forms/Input";
import { formatPounds } from "#/features/rating/money";

import { useCoverPrice, type CoverMoves } from "./ChooseCover";
import { composeCover, TIERS, usableCover } from "./cover";
import { DEFAULT_COVER, type Journey } from "./journey-store";
import { HoldingButton, JourneyPage, StepNav } from "./page-kit";
import { normalisePostcode, postcodeError } from "./postcode";
import { StepHeading } from "./step-kit";

// "Add home insurance to your car quote?" (5.5, decision 11; screen 21, 230:1434, in 5.4b's frame),
// after Choose cover. Nothing is saved before 5.6, so the car quote is "kept", not "saved", and the
// footnote shows the bundle saving that v1 keeps. The home journey arrives in 5.7.

const whole = (pence: number) => formatPounds(pence).replace(".00", "");

export function AddHome({
  journey,
  aside,
  onBack,
  ...moves
}: {
  journey: Journey;
  aside: ReactNode;
  /** "Back to car quote": Choose cover */
  onBack: () => void;
} & CoverMoves) {
  const { result } = useCoverPrice(journey, moves);
  const [postcode, setPostcode] = useState(journey.postcode);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const heading = (
    <StepHeading
      overline="Your car quote / Add another policy"
      title="Add home insurance to your car quote?"
      intro="We’ll keep your car quote while you get a home quote. You can still buy car insurance on its own."
    />
  );

  if (result?.status !== "quoted") {
    return (
      <JourneyPage heading={heading} aside={aside}>
        <Card padding="lg" className="quote-slot">
          <p role="status">Working out your price&hellip;</p>
        </Card>
        <StepNav onBack={onBack} backLabel="Back to car quote" />
      </JourneyPage>
    );
  }

  const chosen = usableCover(result, journey.cover ?? DEFAULT_COVER);
  const composed = composeCover(result, chosen.coverLevel, chosen.addons)!;
  const monthly = journey.payment === "monthly";
  const car = journey.vehicle;
  const main = journey.mainDriver;
  const annual = `${formatPounds(composed.totalPence)} a year`;
  const payments = `12 payments of ${formatPounds(composed.monthlyPaymentPence)}`;

  function addHome() {
    const valid = normalisePostcode(postcode);
    setError(valid ? null : postcodeError);
    setAsked(valid !== null);
  }

  return (
    <JourneyPage heading={heading} aside={aside}>
      <Card padding="lg" as="section" className="quote-addhome__car" aria-labelledby="car-heading">
        <Badge tone="success" dot>
          Your car quote
        </Badge>
        <Icon name="car" size={22} />
        <h2 id="car-heading" className="kb-h3">
          {car ? `${car.make} ${car.model} ${car.variant}` : "Your car"}
        </h2>
        <p className="quote-outcome__meta">
          {[
            car?.demoPlate,
            TIERS[chosen.coverLevel].name,
            main && `${main.firstName} ${main.lastName}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="quote-addhome__price">
          <div>
            <p className="quote-addhome__amount">{monthly ? `${payments}` : annual}</p>
            <p className="quote-outcome__meta">
              Or {monthly ? annual : payments} · Includes Insurance Premium Tax
            </p>
          </div>
          <div>
            <p className="quote-outcome__meta">Total excess</p>
            <p className="quote-addhome__excess">
              {whole(composed.compulsoryExcessPence + composed.voluntaryExcessPence)}
            </p>
          </div>
        </div>
      </Card>

      <Card
        padding="lg"
        as="section"
        className="quote-addhome__home"
        aria-labelledby="home-heading"
      >
        <Icon name="house" size={22} />
        <h2 id="home-heading" className="kb-h3">
          Let&rsquo;s get a home quote
        </h2>
        <Input
          label="Home postcode"
          hint="Carried over from your quote. Change it if the home is elsewhere."
          error={error ?? undefined}
          value={postcode}
          autoComplete="postal-code"
          onChange={(e) => {
            setPostcode(e.target.value);
            setAsked(false);
          }}
        />
        <p>
          Next: confirm your property, contents and security, then past claims. We&rsquo;ll keep
          your car quote while you answer.
        </p>
        <span className="quote-holding">
          <Button variant="accent" onClick={addHome}>
            Add home insurance
          </Button>
          {asked ? (
            <span role="status" className="quote-holding__line">
              Home quotes are coming soon
            </span>
          ) : null}
        </span>
      </Card>

      <p className="quote-addhome__note">
        Car and home are separate policies, each assessed on its own. Insure both with us and save{" "}
        {Math.round(result.bundleDiscountRate * 100)}% on the combined premiums. If one is referred
        or declined, you can still buy the other.
      </p>
      <StepNav
        onBack={onBack}
        backLabel="Back to car quote"
        next={
          <HoldingButton variant="secondary" line="Buying arrives in 5.6">
            Continue with car only
          </HoldingButton>
        }
      />
    </JourneyPage>
  );
}
