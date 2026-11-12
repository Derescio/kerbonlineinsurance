import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Card } from "#/components/display/Card";
import { anonymousId } from "#/lib/analytics";

import { beginJourney, markStartRecorded } from "./journey-store";
import { postcodeDistrict } from "./postcode";
import type { BuyableProductId } from "./products";
import { startQuote } from "./server";

// The Stepper lives in the journey frame now (5.4b, decision 4)
export { JOURNEY_STEPS } from "./frame";

const titles: Record<BuyableProductId, string> = { car: "Car quote", home: "Home quote" };

// What fills each shell's slot, and when (5.1, call 13). Staging only: Phase 5 reaches production
// at its release.
const arrives: Record<BuyableProductId, string> = {
  car: "This step arrives in 5.2",
  home: "This step arrives in 5.7",
};

/**
 * The car and home journey shell: their postcode, and the slot 5.2 (car) and
 * 5.7 (home) fill. On mount it starts or resumes the tab's journey and records `quote.started`
 * once per journey; a failure there is never shown, because the funnel mustn't block a quote.
 */
export function JourneyShell({
  product,
  postcode,
  children,
}: {
  product: BuyableProductId;
  postcode: string;
  /** The step (5.2: car). It owns the page's h1, so the shell's heading steps aside. */
  children?: ReactNode;
}) {
  useEffect(() => {
    const journey = beginJourney(product, postcode);
    if (journey.startRecorded) return;
    startQuote({
      data: {
        product,
        district: postcodeDistrict(postcode),
        journeyId: journey.journeyId,
        anonymousId: anonymousId(),
      },
    })
      .then(() => markStartRecorded(product))
      .catch(() => {
        // Rate-limited or offline: the next visit to the shell tries again
      });
  }, [product, postcode]);

  return (
    <div className="quote-page">
      {children ? (
        <>
          {children}
          <p className="quote-postcode">
            Your postcode: {postcode}.{" "}
            <Link to="/quote" search={{ type: product, postcode }}>
              Change<span className="kb-sr-only"> postcode</span>
            </Link>
          </p>
        </>
      ) : (
        <>
          <header className="quote-heading">
            <p className="quote-heading__overline">{titles[product]}</p>
            <h1 className="kb-h1 quote-heading__title">Your details</h1>
            <p className="quote-heading__intro">
              Postcode: {postcode}.{" "}
              <Link to="/quote" search={{ type: product, postcode }}>
                Change<span className="kb-sr-only"> postcode</span>
              </Link>
            </p>
          </header>
          <Card padding="lg" className="quote-slot">
            <p>{arrives[product]}</p>
          </Card>
        </>
      )}
    </div>
  );
}
