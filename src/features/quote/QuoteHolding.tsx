import { Card } from "#/components/display/Card";

import type { Journey } from "./journey-store";
import { licenceOptions } from "./schemas/driver-steps";
import { StepHeading } from "./step-kit";
import type { DriverStep } from "./steps";

// The holding "Your quote" view (5.3, call 17): where "Get my car quote" lands until 5.4 prices it.
// One short line per step (plan P3), each with an Edit button back to that step.

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
}: {
  journey: Journey;
  onEdit: (step: DriverStep) => void;
}) {
  return (
    <>
      <StepHeading overline="Car · Your quote" title="Your quote" />
      <Card padding="lg" className="quote-slot">
        <p>Your price arrives in 5.4</p>
      </Card>
      <section className="quote-panel" aria-label="Your answers">
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
      </section>
    </>
  );
}
