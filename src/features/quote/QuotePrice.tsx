import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { formatPounds } from "#/features/rating/money";

import type { CarPriceResult } from "#/server/quote/price";

import type { Journey } from "./journey-store";
import { priceQuery } from "./price-query";
import type { NamedDrivers } from "./schemas/driver-steps";
import type { DriverStep } from "./steps";

// The price slot on the holding view (5.4, spec decisions 4 and 14): the Comprehensive price, or why
// there isn't one. A named driver who stopped the quote is named and can be removed on the spot,
// priced again, with Undo to put them back; the threshold that stopped them never is.

export function QuotePrice({
  journey,
  onNamedDrivers,
  onInvalid,
}: {
  journey: Journey;
  /** Saves the named drivers: one removed here, or put back with Undo */
  onNamedDrivers: (namedDrivers: NamedDrivers) => void;
  /** The server found a step that no longer passes: go there, replacing this history entry */
  onInvalid: (step: "car" | DriverStep) => void;
}) {
  const query = useQuery(priceQuery(journey));
  const result = query.data;
  // The driver just removed, and the answer to put back if they press Undo
  const [removed, setRemoved] = useState<{ name: string; before: NamedDrivers } | null>(null);

  // Once per answer: a new callback each render must not send the visitor twice
  const handled = useRef<CarPriceResult | null>(null);
  const invalid = useRef(onInvalid);
  useEffect(() => {
    invalid.current = onInvalid;
  });
  useEffect(() => {
    if (result?.status !== "invalid" || handled.current === result) return;
    handled.current = result;
    invalid.current(result.step);
  }, [result]);

  function remove(position: number) {
    const before = journey.namedDrivers as NamedDrivers;
    const driver = before.drivers[position - 1];
    if (!driver) return;
    const drivers = before.drivers.filter((_, i) => i !== position - 1);
    setRemoved({ name: driver.firstName, before });
    onNamedDrivers({ any: drivers.length > 0, drivers });
  }

  function undo() {
    if (!removed) return;
    onNamedDrivers(removed.before);
    setRemoved(null);
  }

  // One live region stays mounted and only its content changes, so the price is announced
  return (
    <>
      <div role="status" className="quote-price">
        {removed ? (
          <p className="quote-price__removed">
            <span>{removed.name} has been removed from this quote.</span>{" "}
            <button type="button" className="quote-link" onClick={undo}>
              Add {removed.name} back
            </button>
          </p>
        ) : null}
        {query.isError ? null : (
          <PriceContent journey={journey} result={result} onRemove={remove} />
        )}
      </div>
      {query.isError ? (
        <Alert tone="warning" announce>
          <p>We couldn&rsquo;t work out your price just now.</p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : null}
    </>
  );
}

function PriceContent({
  journey,
  result,
  onRemove,
}: {
  journey: Journey;
  result: CarPriceResult | undefined;
  onRemove: (position: number) => void;
}) {
  if (!result || result.status === "invalid") return <p>Working out your price&hellip;</p>;

  switch (result.status) {
    case "quoted":
      return (
        <>
          <h2 className="kb-h3 quote-price__title">Your Comprehensive price</h2>
          <p className="kb-price quote-price__amount">
            {formatPounds(result.annualPence)} a year, or 12 payments of{" "}
            {formatPounds(result.monthlyPaymentPence)}
          </p>
          <p>Premiums include Insurance Premium Tax.</p>
        </>
      );
    case "rate_limited":
      return <p>You&rsquo;ve asked for a lot of prices in a short time. Try again in an hour.</p>;
    case "referred":
    case "declined": {
      const name =
        result.namedDriver === null
          ? null
          : (journey.namedDrivers?.drivers[result.namedDriver - 1]?.firstName ?? null);
      if (!name) {
        return (
          <p>
            {result.status === "referred"
              ? "We need to check a couple of things, usually within a day."
              : "We can’t offer car cover for these details."}
          </p>
        );
      }
      return (
        <>
          <p>
            {result.status === "referred"
              ? `We need to check a couple of things about ${name}.`
              : `We can’t offer cover with ${name} as a named driver.`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => onRemove(result.namedDriver!)}>
            Remove {name} to see a price without them
          </Button>
        </>
      );
    }
  }
}
