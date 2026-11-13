import type { ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Badge } from "#/components/display/Badge";
import { Card } from "#/components/display/Card";
import { formatPounds } from "#/features/rating/money";

import type { Journey } from "./journey-store";
import { HoldingButton, JourneyPage } from "./page-kit";
import { StepHeading } from "./step-kit";

// The referred and declined screens (5.5, decisions 9, 10 and 12), adapted to 5.4b's frame:
// screen 19 (car referred, 226:789), 20 (car declined, 226:804), 03 (home referred, 222:6732) and
// 04 (home declined in a bundle, 222:6747). Nothing is saved before 5.6, so none says it is, and
// none shows a reason code or threshold. The home halves take a home quote's summary: 5.7 shows
// them; until then they're tested with sample home answers.

/** What the bundle screens show of a home quote */
export interface HomeSummary {
  /** "18 Albion Road, London" */
  address: string;
  postcode: string;
  /** "Buildings and contents" */
  cover: string;
}

const reviewLine = "Sending your quote for review arrives in 5.6";

function OutcomeHeading({
  badge,
  overline,
  title,
  intro,
}: {
  badge?: ReactNode;
  overline: string;
  title: string;
  intro: string;
}) {
  return (
    <div className="quote-outcome__head">
      {badge}
      <StepHeading overline={overline} title={title} intro={intro} />
    </div>
  );
}

const underReview = (
  <Badge tone="warning" dot>
    Under review
  </Badge>
);

function carName(journey: Journey): string {
  const car = journey.vehicle;
  return car ? `${car.make} ${car.model} ${car.variant}` : "Your car";
}

/** "2021 · KR24 BXL · Alex Morgan", as much as is known */
function carDetails(journey: Journey): string {
  const main = journey.mainDriver;
  return [
    journey.vehicle?.year,
    journey.vehicle?.demoPlate,
    main ? `${main.firstName} ${main.lastName}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Screen 19: the car quote needs a handler's check (decision 9) */
export function CarReferred({
  journey,
  aside,
  onCheckAnswers,
}: {
  journey: Journey;
  aside: ReactNode;
  onCheckAnswers: () => void;
}) {
  return (
    <JourneyPage
      heading={
        <OutcomeHeading
          badge={underReview}
          overline="Car insurance / Your quote / Review needed"
          title="We need to check a couple of things…"
          intro="We need to review your answers before we can confirm whether we can offer car cover."
        />
      }
      aside={aside}
    >
      <Card padding="lg" as="section" className="quote-outcome" aria-labelledby="next-heading">
        <p className="quote-outcome__name">{carName(journey)}</p>
        <p className="quote-outcome__meta">{carDetails(journey)}</p>
        <h2 id="next-heading" className="kb-h4">
          What happens next?
        </h2>
        <p>
          Our team checks referred quotes, usually within a day. Sign in and we&rsquo;ll send your
          quote for checking: you won&rsquo;t need to start again.
        </p>
        <p className="quote-outcome__key">
          You can&rsquo;t buy this policy while it&rsquo;s under review. No car cover is in place
          yet.
        </p>
      </Card>
      <div className="quote-outcome__actions">
        <HoldingButton variant="primary" line={reviewLine}>
          Sign in to send this for review
        </HoldingButton>
        <Button variant="secondary" onClick={onCheckAnswers}>
          Check your answers
        </Button>
      </div>
    </JourneyPage>
  );
}

/**
 * Screen 20: no car cover (decision 10). On the car journey the second card offers a home quote;
 * given a home quote (5.7's bundle) it's the home half as drawn.
 */
export function CarDeclined({
  journey,
  aside,
  home,
  onCheckAnswers,
  onContinueHome,
}: {
  journey: Journey;
  aside: ReactNode;
  home?: HomeSummary;
  onCheckAnswers: () => void;
  onContinueHome?: () => void;
}) {
  return (
    <JourneyPage
      heading={
        home ? (
          <OutcomeHeading
            overline="Your bundle / Quote update"
            title="Your home quote is still available"
            intro="We can’t offer car cover on this occasion. You can still continue with home insurance on its own."
          />
        ) : (
          <OutcomeHeading
            overline="Car insurance / Your quote"
            title="We’re unable to offer car cover"
            intro="We can’t offer car cover on this occasion."
          />
        )
      }
      aside={aside}
    >
      <Card padding="lg" as="section" className="quote-outcome" aria-label="Car">
        <Badge>Car · Not available</Badge>
        {home ? <h2 className="kb-h3">We&rsquo;re unable to offer car cover</h2> : null}
        <p>
          Based on the details provided, this car quote doesn&rsquo;t fit the cover available
          through our online policy.{home ? " This doesn’t affect your home quote." : null}
        </p>
        <p className="quote-outcome__meta">
          {[carName(journey), journey.vehicle?.demoPlate].filter(Boolean).join(" · ")}
        </p>
        <button type="button" className="quote-link" onClick={onCheckAnswers}>
          Check car answers
        </button>
      </Card>
      {home ? (
        <Card padding="lg" as="section" className="quote-outcome" aria-label="Home">
          <Badge tone="success" dot>
            Home · Ready to buy
          </Badge>
          <h2 className="kb-h3">{home.address}</h2>
          <p className="quote-outcome__meta">
            {home.postcode} · {home.cover}
          </p>
          <div className="quote-outcome__box">
            <h3 className="kb-h4">Continue with home only</h3>
            <p>
              Car cover has been removed from this bundle. Review your home-only quote, including
              its price and cover, before paying.
            </p>
          </div>
          <Button variant="accent" onClick={onContinueHome}>
            Review home quote and continue
          </Button>
        </Card>
      ) : (
        <Card padding="lg" as="section" className="quote-outcome" aria-labelledby="home-offer">
          <h2 id="home-offer" className="kb-h3">
            Insure your home with us instead?
          </h2>
          <p>Car and home are separate policies, so a home quote is assessed on its own.</p>
          <HoldingButton variant="accent" line="Home quotes are coming soon">
            Get a home quote
          </HoldingButton>
        </Card>
      )}
    </JourneyPage>
  );
}

/** Screen 03: the home quote needs a handler's check (decision 12) */
export function HomeReferred({
  home,
  aside,
  onCheckAnswers,
}: {
  home: HomeSummary;
  aside: ReactNode;
  onCheckAnswers: () => void;
}) {
  return (
    <JourneyPage
      heading={
        <OutcomeHeading
          badge={underReview}
          overline="Home quote / Review needed"
          title="We need to check a couple of things…"
          intro="Your answers need a closer look before we can confirm whether we can offer cover."
        />
      }
      aside={aside}
    >
      <Card padding="lg" as="section" className="quote-outcome" aria-labelledby="next-heading">
        <div className="quote-outcome__box quote-outcome__box--plain">
          <p className="quote-heading__overline">Home insurance</p>
          <p className="quote-outcome__name">{home.address}</p>
          <p className="quote-outcome__meta">
            {home.postcode} · {home.cover}
          </p>
        </div>
        <h2 id="next-heading" className="kb-h4">
          What happens next?
        </h2>
        <ol className="quote-outcome__steps">
          <li>We check the information you&rsquo;ve given us.</li>
          <li>We contact you with the outcome or any questions.</li>
          <li>If we can offer cover, you can review the quote before buying.</li>
        </ol>
        <p className="quote-outcome__small">
          Sign in and we&rsquo;ll send your quote for checking: you won&rsquo;t need to start again.
          No cover is in place yet. You can&rsquo;t buy this policy while it&rsquo;s under review.
        </p>
      </Card>
      <div className="quote-outcome__actions">
        <HoldingButton variant="primary" line={reviewLine}>
          Sign in to send this for review
        </HoldingButton>
        <Button variant="secondary" onClick={onCheckAnswers}>
          Check your answers
        </Button>
      </div>
    </JourneyPage>
  );
}

/** What screen 04 shows of the car: the car alone, so no bundle discount (decision 12) */
export interface CarOnly {
  name: string;
  plate?: string;
  coverName: string;
  /** The car's own annual total with IPT */
  totalPence: number;
}

/** Screen 04: home declined in a bundle, the car still buyable (decision 12) */
export function HomeDeclinedBundle({
  home,
  car,
  aside,
  onCheckHome,
  onContinueCar,
}: {
  home: HomeSummary;
  car: CarOnly;
  aside: ReactNode;
  onCheckHome: () => void;
  onContinueCar: () => void;
}) {
  return (
    <JourneyPage
      heading={
        <OutcomeHeading
          overline="Your bundle / Quote update"
          title="Your car quote is still available"
          intro="We can’t offer home cover on this occasion. You can continue with car insurance on its own."
        />
      }
      aside={aside}
    >
      <Card padding="lg" as="section" className="quote-outcome" aria-label="Home">
        <Badge>Home · Not available</Badge>
        <h2 className="kb-h3">We&rsquo;re unable to offer home cover</h2>
        <p>
          Based on the details provided, this property doesn&rsquo;t fit the cover available through
          our online home policy. This doesn&rsquo;t affect your car quote.
        </p>
        <p className="quote-outcome__meta">
          {home.address} · {home.postcode}
        </p>
        <button type="button" className="quote-link" onClick={onCheckHome}>
          Check home answers
        </button>
      </Card>
      <Card padding="lg" as="section" className="quote-outcome" aria-label="Car">
        <Badge tone="success" dot>
          Car · Ready to buy
        </Badge>
        <h2 className="kb-h3">{car.name}</h2>
        <p className="quote-outcome__meta">
          {[car.plate, `${car.coverName} cover`].filter(Boolean).join(" · ")}
        </p>
        <div className="quote-outcome__box">
          <p>Car-only annual total</p>
          <p className="quote-outcome__total kb-price">{formatPounds(car.totalPence)}</p>
          <p>Includes Insurance Premium Tax. Home cover is not included.</p>
        </div>
        <p>Your updated total is for car insurance only. Review the cover before paying.</p>
        <Button variant="accent" onClick={onContinueCar}>
          Continue with car only
        </Button>
      </Card>
    </JourneyPage>
  );
}
