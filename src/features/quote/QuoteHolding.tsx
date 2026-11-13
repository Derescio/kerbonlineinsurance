import { useEffect, useRef, type ReactNode } from "react";

import { Card } from "#/components/display/Card";

import { TIERS, usableCover } from "./cover";
import type { CoverChoice, Journey } from "./journey-store";
import { CarDeclined, CarReferred } from "./Outcomes";
import type { NamedDrivers } from "./schemas/driver-steps";
import { DriverReview, reviewIntro } from "./DriverReview";
import { QuotePrice, RemovedLine, useQuotePrice } from "./QuotePrice";
import { licenceOptions } from "./schemas/driver-steps";
import { HelpCard, JourneyPage, StepNav } from "./page-kit";
import { StepHeading } from "./step-kit";
import type { DriverStep } from "./steps";

// The "Your quote" view (5.3, call 17), as Revamp R09 "Your quote is ready" (5.4b, call 10): the
// price from 5.4 with the pay choice, or screen 19 or 20 when the quote is referred or declined
// for a reason that isn't a named driver (5.5, decisions 9 and 10), above "Your details at a glance", one short line per step
// (plan P3), each with an Edit button back to that step.

const longDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function rows(journey: Journey): { step: DriverStep; title: string; value: string }[] {
  const main = journey.mainDriver;
  const usage = journey.usage;
  const incidents = journey.claims?.incidents.length ?? 0;
  const drivers = journey.namedDrivers?.drivers ?? [];
  const licence = licenceOptions.find((o) => o.value === main?.licenceType)?.label ?? "";
  const noClaims = main?.noClaimsYears === 9 ? "9 or more" : String(main?.noClaimsYears ?? 0);
  return [
    {
      step: "about",
      title: "About you",
      value: main
        ? `${main.firstName} ${main.lastName}, born ${longDate.format(new Date(main.dateOfBirth))}`
        : "",
    },
    {
      step: "driving",
      title: "Licence and driving",
      value: usage
        ? `${licence}, ${noClaims} years’ no-claims, ${usage.annualMileage.toLocaleString("en-GB")} miles a year`
        : "",
    },
    {
      step: "claims",
      title: "Claims",
      value: incidents ? plural(incidents, "incident", "incidents") : "None",
    },
    {
      step: "drivers",
      title: "Named drivers",
      value: drivers.length
        ? drivers.map((d) => `${d.firstName} ${d.lastName}`).join(", ")
        : "None",
    },
  ];
}

export function QuoteHolding({
  journey,
  onEdit,
  onNamedDrivers,
  onInvalid,
  onBack,
  onReviewDrivers,
  onChooseCover,
  onCover,
  carCard,
}: {
  journey: Journey;
  /** "Back to your details": Named drivers (5.4b, call 10) */
  onBack: () => void;
  /** R10's "Review named driver details" (5.4b, call 11) */
  onReviewDrivers: () => void;
  /** R09's "Choose cover" (5.5) */
  onChooseCover: () => void;
  /** Saves the cover choice, when the server resets the excess (5.5) */
  onCover: (cover: CoverChoice) => void;
  /** The "Your car" card (5.4b, call 6); the help card's line changes with the view */
  carCard: ReactNode;
  onEdit: (step: DriverStep) => void;
  /** Saves the named drivers after one is removed or put back from the price (5.4) */
  onNamedDrivers: (namedDrivers: NamedDrivers) => void;
  /** Where the server sends a step that no longer passes (5.4) */
  onInvalid: (step: "car" | DriverStep) => void;
}) {
  const car = journey.vehicle;
  const price = useQuotePrice(journey, onNamedDrivers, onInvalid, onCover);
  const stopper = price.stopper;
  const { result } = price;
  const outcome =
    !stopper && (result?.status === "referred" || result?.status === "declined")
      ? result.status
      : null;
  const kind = stopper ? "review" : (outcome ?? "quote");
  const tier =
    TIERS[
      (result?.status === "quoted" ? usableCover(result, price.cover) : price.cover).coverLevel
    ];

  // R09, R10 and screens 19 and 20 are one view whose heading changes: focus follows it, as a step
  // change does
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(kind);
  useEffect(() => {
    if (shown.current === kind) return;
    shown.current = kind;
    root.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [kind]);

  const aside = (
    <>
      {carCard}
      <HelpCard title="Need a hand?">
        {stopper
          ? "You can review your driver details or contact us to talk through the next steps."
          : "Keep your vehicle documents and driving licence nearby as you complete your details."}
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

  return (
    <div ref={root} className="quote-step">
      {outcome === "referred" ? (
        <CarReferred journey={journey} aside={aside} onCheckAnswers={() => onEdit("about")} />
      ) : outcome === "declined" ? (
        <CarDeclined journey={journey} aside={aside} onCheckAnswers={() => onEdit("about")} />
      ) : stopper ? (
        <JourneyPage
          heading={
            <StepHeading
              overline="Car insurance / Your quote"
              title="Let’s review your named driver"
              intro={reviewIntro(stopper.name, stopper.outcome)}
            />
          }
          aside={aside}
        >
          <RemovedLine state={price} />
          <DriverReview
            name={stopper.name}
            outcome={stopper.outcome}
            onRemove={() => price.remove(stopper.position)}
            onReview={onReviewDrivers}
          />
          {glance}
          <StepNav onBack={onBack} backLabel="Back to your details" />
        </JourneyPage>
      ) : (
        <JourneyPage
          heading={
            <StepHeading
              overline="Car insurance / Your quote"
              title="Your quote is ready"
              intro={
                car
                  ? `${tier.name} car insurance for your ${car.make} ${car.model} ${car.variant}.`
                  : undefined
              }
            />
          }
          aside={aside}
        >
          <Card padding="lg" className="quote-slot">
            <QuotePrice state={price} onChooseCover={onChooseCover} />
          </Card>
          {glance}
          <StepNav onBack={onBack} backLabel="Back to your details" />
        </JourneyPage>
      )}
    </div>
  );
}
