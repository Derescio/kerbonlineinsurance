import type { ReactNode } from "react";

import { Card } from "#/components/display/Card";

import type { Journey } from "./journey-store";
import type { NamedDrivers } from "./schemas/driver-steps";
import { QuotePrice } from "./QuotePrice";
import { licenceOptions } from "./schemas/driver-steps";
import { JourneyPage, StepNav } from "./page-kit";
import { StepHeading } from "./step-kit";
import type { DriverStep } from "./steps";

// The "Your quote" view (5.3, call 17), as Revamp R09 "Your quote is ready" (5.4b, call 10): the
// price from 5.4 with the pay choice, above "Your details at a glance", one short line per step
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
  aside,
}: {
  journey: Journey;
  /** "Back to your details": Named drivers (5.4b, call 10) */
  onBack: () => void;
  /** The "Your car" and help cards (5.4b) */
  aside: ReactNode;
  onEdit: (step: DriverStep) => void;
  /** Saves the named drivers after one is removed or put back from the price (5.4) */
  onNamedDrivers: (namedDrivers: NamedDrivers) => void;
  /** Where the server sends a step that no longer passes (5.4) */
  onInvalid: (step: "car" | DriverStep) => void;
}) {
  const car = journey.vehicle;
  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Car insurance / Your quote"
          title="Your quote is ready"
          intro={
            car
              ? `Comprehensive car insurance for your ${car.make} ${car.model} ${car.variant}.`
              : undefined
          }
        />
      }
      aside={aside}
    >
      <Card padding="lg" className="quote-slot">
        <QuotePrice journey={journey} onNamedDrivers={onNamedDrivers} onInvalid={onInvalid} />
      </Card>
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
      <StepNav onBack={onBack} backLabel="Back to your details" />
    </JourneyPage>
  );
}
