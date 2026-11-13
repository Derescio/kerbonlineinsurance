import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";

import { CarNotListed } from "./CarNotListed";
import { JourneyPage, StepNav } from "./page-kit";
import { PlateBox, type PlateViewProps } from "./PlateLookup";
import { StepHeading } from "./step-kit";

/** Screen 10 (Figma 226:654): the plate didn't match a demo plate. The plate is kept in the box.
 * In the revamp's frame as it is (5.4b, decision 2). */
export function VehicleNotFound({
  plate,
  onPlate,
  onFind,
  error,
  finding,
  loadError,
  onManual,
  tabs,
  aside,
  onBack,
}: PlateViewProps) {
  const [contact, setContact] = useState(false);
  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Car insurance / Your details"
          title="We don’t have that car"
          intro="We couldn’t match this registration to a car in our records. You can try again or choose your car manually."
        />
      }
      tabs={tabs}
      aside={aside}
    >
      <div className="quote-panel">
        <Alert tone="neutral" title="No matching car found">
          Your quote is still here. Try the registration again or use manual lookup.
        </Alert>
        <PlateBox
          plate={plate}
          onPlate={onPlate}
          onFind={onFind}
          error={error}
          hint="Check every letter and number, then try again."
          finding={finding}
          findLabel="Try registration again"
          showDemoPlates
        />
        {loadError}
      </div>
      <section className="quote-aside" aria-labelledby="another-way">
        <h2 id="another-way" className="kb-h3">
          Find it another way
        </h2>
        <p>
          Choose the make, model, year and variant. If the exact variant isn&rsquo;t listed, contact
          us rather than choosing a different car.
        </p>
        <Button variant="accent" onClick={onManual}>
          Choose my car manually
        </Button>
      </section>
      <button type="button" className="quote-link" onClick={() => setContact(true)}>
        Contact us about this car
      </button>
      {contact ? <CarNotListed /> : null}
      <StepNav onBack={onBack} />
    </JourneyPage>
  );
}
