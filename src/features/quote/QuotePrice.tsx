import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";

import type { QuotePriceResult } from "#/server/quote/price";

import { composeCover, TIERS, usableCover } from "./cover";
import type { HomeStep } from "./home-steps";
import {
  DEFAULT_COVER,
  setPayment,
  type CoverChoice,
  type Journey,
  type Payment,
} from "./journey-store";
import { PayChoice } from "./PayChoice";
import { priceQuery } from "./price-query";
import type { BuyableProductId } from "./products";
import type { NamedDrivers } from "./schemas/driver-steps";
import type { DriverStep } from "./steps";

// The price on Your quote (5.4, spec decisions 4 and 14; 5.4b, calls 10 and 11): the chosen cover's
// price (Comprehensive, £0 and no extras until Choose cover; 5.5, decision 16) with the pay choice,
// or why there isn't one. A named driver who stopped the quote gets the
// review step (R10): they can be removed on the spot, priced again, with "Add back" to put them
// back; the threshold that stopped them is never shown.

/** The named driver who stopped the quote, if one did */
export interface Stopper {
  name: string;
  position: number;
  outcome: "referred" | "declined";
}

/** Your quote's price, for either product (5.7) */
export interface PriceState {
  query: UseQueryResult<QuotePriceResult>;
  result: QuotePriceResult | undefined;
  payment: Payment;
  choosePayment: (value: Payment) => void;
  /** The cover chosen so far (5.5) */
  cover: CoverChoice;
}

/** Car's adds the named driver who stopped the quote, and removing one (5.4) */
export interface QuotePriceState extends PriceState {
  stopper: Stopper | null;
  /** The driver just removed, and the answer "Add back" puts back */
  removed: { name: string; before: NamedDrivers } | null;
  remove: (position: number) => void;
  undo: () => void;
}

/** The price and the pay choice; a step the server sends back to goes to `onInvalid` */
export function usePrice(
  product: BuyableProductId,
  journey: Journey,
  onInvalid: (step: "car" | DriverStep | HomeStep) => void,
  /** An excess the server doesn't offer goes back to £0 (5.5, decision 6) */
  onCover: (cover: CoverChoice) => void,
): PriceState {
  const query = useQuery(priceQuery(product, journey));
  const result = query.data;
  // Kept in the tab for Choose cover and Buy; it never changes the price (5.4b, call 10)
  const [payment, setPaymentState] = useState<Payment>(journey.payment ?? "annual");

  // Once per answer: a new callback each render must not send the visitor twice
  const handled = useRef<QuotePriceResult | null>(null);
  const cover = journey.cover ?? DEFAULT_COVER;
  const moves = useRef({ onInvalid, onCover, cover });
  useEffect(() => {
    moves.current = { onInvalid, onCover, cover };
  });
  useEffect(() => {
    if (result?.status !== "invalid" || handled.current === result) return;
    handled.current = result;
    const { step } = result;
    if (step === "cover")
      moves.current.onCover({ ...moves.current.cover, voluntaryExcessPence: 0 });
    else moves.current.onInvalid(step);
  }, [result]);

  return {
    query,
    result,
    payment,
    cover,
    choosePayment(value) {
      setPaymentState(value);
      setPayment(product, value);
    },
  };
}

/** Held by Your quote, so the state survives the switch between R09 and R10 */
export function useQuotePrice(
  journey: Journey,
  onNamedDrivers: (namedDrivers: NamedDrivers) => void,
  onInvalid: (step: "car" | DriverStep) => void,
  onCover: (cover: CoverChoice) => void,
): QuotePriceState {
  const price = usePrice("car", journey, onInvalid as (step: string) => void, onCover);
  const { result } = price;
  const [removed, setRemoved] = useState<QuotePriceState["removed"]>(null);

  let stopper: Stopper | null = null;
  if ((result?.status === "referred" || result?.status === "declined") && result.namedDriver) {
    const name = journey.namedDrivers?.drivers[result.namedDriver - 1]?.firstName;
    if (name) stopper = { name, position: result.namedDriver, outcome: result.status };
  }

  return {
    ...price,
    stopper,
    removed,
    remove(position) {
      const before = journey.namedDrivers as NamedDrivers;
      const driver = before.drivers[position - 1];
      if (!driver) return;
      const drivers = before.drivers.filter((_, i) => i !== position - 1);
      setRemoved({ name: driver.firstName, before });
      onNamedDrivers({ any: drivers.length > 0, drivers });
    },
    undo() {
      if (!removed) return;
      onNamedDrivers(removed.before);
      setRemoved(null);
    },
  };
}

/** "Sam has been removed from this quote. Add Sam back" */
export function RemovedLine({ state }: { state: PriceState & Partial<QuotePriceState> }) {
  const { removed, undo } = state;
  if (!removed || !undo) return null;
  return (
    <p className="quote-price__removed">
      <span>{removed.name} has been removed from this quote.</span>{" "}
      <button type="button" className="quote-link" onClick={undo}>
        Add {removed.name} back
      </button>
    </p>
  );
}

/** R09's price card. One live region stays mounted and only its content changes, so the price is announced. */
export function QuotePrice({
  state,
  onChooseCover,
}: {
  state: PriceState & Partial<QuotePriceState>;
  onChooseCover: () => void;
}) {
  const { query, result } = state;
  return (
    <>
      <div role="status" className="quote-price">
        <RemovedLine state={state} />
        {query.isError ? null : (
          <PriceContent state={state} result={result} onChooseCover={onChooseCover} />
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
  state,
  result,
  onChooseCover,
}: {
  state: PriceState;
  result: QuotePriceResult | undefined;
  onChooseCover: () => void;
}) {
  if (!result || result.status === "invalid") return <p>Working out your price&hellip;</p>;

  switch (result.status) {
    case "quoted": {
      const chosen = usableCover(result, state.cover);
      const composed = composeCover(result, chosen.coverLevel, chosen.addons)!;
      return (
        <>
          <h2 className="kb-h3 quote-price__title">Your {TIERS[chosen.coverLevel].name} price</h2>
          <PayChoice
            annualPence={composed.totalPence}
            monthlyPaymentPence={composed.monthlyPaymentPence}
            value={state.payment}
            onChange={state.choosePayment}
          />
          <p>Premiums include Insurance Premium Tax.</p>
          <Button variant="accent" iconRight="arrow-right" onClick={onChooseCover}>
            Choose cover
          </Button>
        </>
      );
    }
    case "rate_limited":
      return <p>You&rsquo;ve asked for a lot of prices in a short time. Try again in an hour.</p>;
    // Your quote shows R10 (a named driver) or screens 19 and 20 in place of the price (5.5)
    case "referred":
    case "declined":
      return null;
  }
}
