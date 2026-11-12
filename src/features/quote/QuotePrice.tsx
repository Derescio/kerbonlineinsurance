import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { formatPounds } from "#/features/rating/money";

import type { Journey } from "./journey-store";
import { priceQuery } from "./price-query";
import type { DriverStep } from "./steps";

// The price slot on the holding view (5.4, spec decisions 4 and 14): the Comprehensive price, or why
// there isn't one. A named driver who stopped the quote is named, with a way to remove them; the
// threshold that stopped it never is.

export function QuotePrice({
  journey,
  onEdit,
  onCar,
}: {
  journey: Journey;
  onEdit: (step: DriverStep) => void;
  onCar: () => void;
}) {
  const query = useQuery(priceQuery(journey));
  const result = query.data;

  // The server found a step that no longer passes: send the visitor there
  useEffect(() => {
    if (result?.status !== "invalid") return;
    if (result.step === "car") onCar();
    else onEdit(result.step);
  }, [result, onCar, onEdit]);

  if (query.isError) {
    return (
      <Alert tone="warning" announce>
        <p>We couldn&rsquo;t work out your price just now.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  }
  if (!result || result.status === "invalid") {
    return <p role="status">Working out your price&hellip;</p>;
  }

  switch (result.status) {
    case "quoted":
      return (
        <div role="status" className="quote-price">
          <h2 className="kb-h3 quote-price__title">Your Comprehensive price</h2>
          <p className="kb-price quote-price__amount">
            {formatPounds(result.annualPence)} a year, or 12 payments of{" "}
            {formatPounds(result.monthlyPaymentPence)}
          </p>
          <p>Premiums include Insurance Premium Tax.</p>
        </div>
      );
    case "rate_limited":
      return (
        <p role="status">
          You&rsquo;ve asked for a lot of prices in a short time. Try again in an hour.
        </p>
      );
    case "referred":
    case "declined": {
      const name =
        result.namedDriver === null
          ? null
          : (journey.namedDrivers?.drivers[result.namedDriver - 1]?.firstName ?? null);
      if (!name) {
        return (
          <p role="status">
            {result.status === "referred"
              ? "We need to check a couple of things, usually within a day."
              : "We can’t offer car cover for these details."}
          </p>
        );
      }
      return (
        <div role="status">
          <p>
            {result.status === "referred"
              ? `We need to check a couple of things about ${name}.`
              : `We can’t offer cover with ${name} as a named driver.`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => onEdit("drivers")}>
            Remove {name} to see a price without them
          </Button>
        </div>
      );
    }
  }
}
