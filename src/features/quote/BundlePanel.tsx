import { useQuery } from "@tanstack/react-query";

import { Button } from "#/components/actions/Button";
import { Card } from "#/components/display/Card";
import { formatPounds } from "#/features/rating/money";

import { composeBundle } from "./bundle";
import { TIERS, usableCover, type CoverPrices } from "./cover";
import { DEFAULT_COVER, type CoverChoice, type Journey } from "./journey-store";
import { priceQuery } from "./price-query";

// Screen 22's side panel (5.7b, decision 4; 230:1449, in 5.4b's frame): the car quote waiting in
// the tab beside the home being chosen, each at its price after its share of the saving, the
// saving, and both together. "Your car quote", not "still saved": nothing is saved until the gate.

export function BundlePanel({
  car,
  homePrices,
  homeCover,
  onHomeOnly,
  onBackToCar,
}: {
  car: Journey;
  homePrices: CoverPrices;
  homeCover: CoverChoice;
  onHomeOnly: () => void;
  onBackToCar: () => void;
}) {
  const { data } = useQuery(priceQuery("car", car));
  const carPrices = data?.status === "quoted" ? data : null;
  const carCover = carPrices ? usableCover(carPrices, car.cover ?? DEFAULT_COVER) : null;
  const money =
    carPrices && carCover
      ? composeBundle(
          { prices: carPrices, cover: carCover },
          { prices: homePrices, cover: homeCover },
        )
      : null;
  const vehicle = car.vehicle;

  return (
    <Card padding="lg" as="section" className="quote-bundle" aria-labelledby="bundle-heading">
      <h2 id="bundle-heading" className="kb-h3">
        Your car quote
      </h2>
      <p className="quote-outcome__meta">
        {[
          vehicle?.demoPlate ?? (vehicle ? `${vehicle.make} ${vehicle.model}` : undefined),
          carCover ? TIERS[carCover.coverLevel].name : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {money ? (
        <>
          <dl className="quote-breakdown__lines">
            <div>
              <dt>Car</dt>
              <dd>{formatPounds(money.car.totalPence)}</dd>
            </div>
            <div>
              <dt>Home</dt>
              <dd>{formatPounds(money.home.totalPence)}</dd>
            </div>
            <div>
              <dt>Bundle saving</dt>
              <dd>−{formatPounds(money.savingPence)}</dd>
            </div>
          </dl>
          <p className="quote-bundle__total">Together: {formatPounds(money.totalPence)} a year</p>
          <p className="quote-outcome__meta">
            Or 12 combined payments of {formatPounds(money.monthlyPaymentPence)}
          </p>
          <p className="quote-outcome__small">
            Two separate policies, each assessed on its own, with{" "}
            {Math.round(homePrices.bundleDiscountRate * 100)}% off the combined premiums. Prices
            include Insurance Premium Tax.
          </p>
        </>
      ) : (
        <p role="status">Working out your car price&hellip;</p>
      )}
      <div className="quote-outcome__actions">
        <Button variant="secondary" onClick={onHomeOnly}>
          Continue with home only
        </Button>
        <Button variant="ghost" onClick={onBackToCar}>
          Back to car quote
        </Button>
      </div>
    </Card>
  );
}
