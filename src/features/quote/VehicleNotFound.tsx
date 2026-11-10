import { useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";

import { CarNotListed } from "./CarNotListed";
import { PlateBox } from "./PlateLookup";

/** Screen 10 (Figma 226:654): the plate didn't match a demo plate. The plate is kept in the box. */
export function VehicleNotFound({
  plate,
  onPlate,
  onFind,
  error,
  finding,
  loadError,
  onManual,
}: {
  plate: string;
  onPlate: (plate: string) => void;
  onFind: () => void;
  error?: string;
  finding: boolean;
  loadError: ReactNode;
  onManual: () => void;
}) {
  const [contact, setContact] = useState(false);
  return (
    <>
      <header className="quote-heading">
        <p className="quote-heading__overline">Car · Lookup help</p>
        <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
          We don&rsquo;t have that car
        </h1>
        <p className="quote-heading__intro">
          We couldn&rsquo;t match this registration to a car in our records. You can try again or
          choose your car manually.
        </p>
      </header>
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
    </>
  );
}
