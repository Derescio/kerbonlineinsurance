import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";

import { TIERS, usableCover } from "./cover";
import type { HomeStep } from "./home-steps";
import type { CoverChoice, Journey } from "./journey-store";
import {
  HomeDeclined,
  HomeDeclinedBundle,
  HomeReferred,
  type CarOnly,
  type HomeSummary,
} from "./Outcomes";
import { HelpCard, JourneyPage, StepNav } from "./page-kit";
import { QuotePrice, usePrice } from "./QuotePrice";
import { useSignedIn } from "./restart";
import { alarmOptions, propertyTypeLabel } from "./schemas/home-steps";
import { StepHeading } from "./step-kit";

// Your quote on the home journey (5.7, decisions 7 and 8), as car's R09: the price with the pay
// choice above "Your details at a glance", or screen 03 (referred) or the declined screen.

const longDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const pounds = (n: number) => `£${n.toLocaleString("en-GB")}`;

function rows(journey: Journey): { step: HomeStep; title: string; value: string }[] {
  const about = journey.homeAbout;
  const property = journey.property;
  const contents = journey.contents;
  const claims = journey.homeClaims;
  const count = claims?.any ? claims.claims.length : 0;
  const alarm = alarmOptions.find((o) => o.value === contents?.alarm)?.label ?? "";
  return [
    {
      step: "about",
      title: "About you",
      value: about
        ? `${about.firstName} ${about.lastName}, born ${longDate.format(new Date(about.dateOfBirth))}`
        : "",
    },
    {
      step: "property",
      title: "Property",
      value: property
        ? [
            property.address?.line1,
            propertyTypeLabel(property.propertyType),
            property.bedrooms === 0
              ? "studio"
              : `${property.bedrooms} bedroom${property.bedrooms === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(", ")
        : "",
    },
    {
      step: "contents",
      title: "Contents and security",
      value: contents ? `${pounds(contents.contentsValuePounds)} contents, ${alarm}` : "",
    },
    {
      step: "claims",
      title: "Past claims",
      value: count ? `${count} claim${count === 1 ? "" : "s"}` : "None",
    },
  ];
}

/** What the outcome screens show of the home */
export function homeSummary(journey: Journey): HomeSummary {
  const address = journey.property?.address;
  return {
    address: address ? `${address.line1}, ${address.town}` : "Your home",
    postcode: journey.postcode,
    cover: "Buildings and contents",
  };
}

export function HomeQuote({
  journey,
  homeCard,
  onBack,
  onEdit,
  onInvalid,
  onChooseCover,
  onCover,
  onSaveAndExit,
  bundle,
}: {
  journey: Journey;
  /** The "Your home" card */
  homeCard: ReactNode;
  /** "Back to your details": Past claims */
  onBack: () => void;
  onEdit: (step: HomeStep) => void;
  /** Where the server sends a step that no longer passes */
  onInvalid: (step: HomeStep) => void;
  onChooseCover: () => void;
  onCover: (cover: CoverChoice) => void;
  /** The gate and the save, then Your saved quotes; also screen 03's "Sign in to send this for review" */
  onSaveAndExit: () => void;
  /** In a live bundle (5.7b, decision 5): the car, buyable alone when the home can't be bought */
  bundle?: { car: CarOnly | null; onCarOnly: () => void; onSendForReview: () => void };
}) {
  const price = usePrice("home", journey, (step) => onInvalid(step as HomeStep), onCover);
  const { result } = price;
  const signedIn = useSignedIn();
  const outcome =
    result?.status === "referred" || result?.status === "declined" ? result.status : null;
  const kind = outcome ?? "quote";
  const tier =
    TIERS[
      (result?.status === "quoted" ? usableCover(result, price.cover) : price.cover).coverLevel
    ];

  // The heading changes with the outcome: focus follows it, as a step change does
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(kind);
  useEffect(() => {
    if (shown.current === kind) return;
    shown.current = kind;
    root.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [kind]);

  const aside = (
    <>
      {homeCard}
      <HelpCard title="Need a hand?">
        {outcome
          ? "Need to correct something or ask a question? Check your answers, or contact us."
          : "Have your property’s details to hand, like when it was built and its rebuild cost."}
      </HelpCard>
    </>
  );

  const glance = (
    <Card padding="lg" as="section" className="quote-glance" aria-labelledby="glance-heading">
      <h2 id="glance-heading" className="kb-h3">
        Your details at a glance
      </h2>
      <dl className="quote-summary">
        {rows(journey).map((row) => (
          <div key={row.step} className="quote-summary__row">
            <dt>{row.title}</dt>
            <dd>{row.value}</dd>
            <dd>
              <button type="button" className="quote-link" onClick={() => onEdit(row.step)}>
                Edit<span className="kb-sr-only"> {row.title}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );

  const address = journey.property?.address;
  return (
    <div ref={root} className="quote-step">
      {outcome === "referred" ? (
        <HomeReferred
          home={homeSummary(journey)}
          aside={aside}
          signedIn={signedIn}
          onCheckAnswers={() => onEdit("about")}
          onSendForReview={bundle?.onSendForReview ?? onSaveAndExit}
          onContinueCar={bundle?.onCarOnly}
        />
      ) : outcome === "declined" && bundle ? (
        bundle.car ? (
          <HomeDeclinedBundle
            home={homeSummary(journey)}
            car={bundle.car}
            aside={aside}
            onCheckHome={() => onEdit("property")}
            onContinueCar={bundle.onCarOnly}
          />
        ) : (
          // Screen 04 waits for the car's own price, rather than flash home-alone's screen
          <JourneyPage
            heading={<StepHeading overline="Your bundle / Quote update" title="Your quote" />}
            aside={aside}
          >
            <Card padding="lg" className="quote-slot">
              <p role="status">Working out your price&hellip;</p>
            </Card>
          </JourneyPage>
        )
      ) : outcome === "declined" ? (
        <HomeDeclined
          home={homeSummary(journey)}
          postcode={journey.postcode}
          aside={aside}
          onCheckAnswers={() => onEdit("property")}
        />
      ) : (
        <JourneyPage
          heading={
            <StepHeading
              overline="Home insurance / Your quote"
              title="Your quote is ready"
              intro={
                address
                  ? `${tier.name} home insurance for ${address.line1}, ${address.town}.`
                  : undefined
              }
            />
          }
          aside={aside}
          asideLabel="Your home and help"
        >
          <Card padding="lg" className="quote-slot">
            <QuotePrice state={price} onChooseCover={onChooseCover} />
          </Card>
          {glance}
          <StepNav
            onBack={onBack}
            backLabel="Back to your details"
            next={
              result?.status === "quoted" ? (
                <Button variant="secondary" onClick={onSaveAndExit}>
                  Save and exit
                </Button>
              ) : null
            }
          />
        </JourneyPage>
      )}
    </div>
  );
}
