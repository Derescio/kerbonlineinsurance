import { useEffect, useRef, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";

import { demoPlates } from "./demo-plates";
import { JourneyPage, StepNav } from "./page-kit";
import { StepHeading } from "./step-kit";

/**
 * The registration box, shared by screens 08 and 10. Tapping a demo plate only fills the box, so the
 * viewer sees the plate go in before "Find my car" (5.2, call 6).
 */
export function PlateBox({
  plate,
  onPlate,
  onFind,
  error,
  hint,
  finding,
  findLabel,
  showDemoPlates,
}: {
  plate: string;
  onPlate: (plate: string) => void;
  onFind: () => void;
  error?: string;
  hint: string;
  finding: boolean;
  findLabel: string;
  showDemoPlates: boolean;
}) {
  // An empty box gets focus with its error, as the start form's postcode does (5.1)
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onFind();
  }

  return (
    <form className="quote-plate" onSubmit={submit} noValidate>
      <Input
        ref={input}
        label="Car registration"
        variant="plate"
        placeholder="KR24 BXL"
        autoComplete="off"
        spellCheck={false}
        value={plate}
        onChange={(event) => onPlate(event.target.value)}
        hint={hint}
        error={error}
      />
      {showDemoPlates ? (
        <div className="quote-plate__demo">
          <p id="demo-plates-label">
            Kerb is a demo, so only these plates are recognised currently. Please choose one:
          </p>
          <ul aria-labelledby="demo-plates-label">
            {demoPlates.map(({ plate: demo }) => (
              <li key={demo}>
                <button type="button" className="quote-plate__chip" onClick={() => onPlate(demo)}>
                  {demo}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="quote-start__actions">
        <Button type="submit" variant="accent" loading={finding} loadingLabel="Loading cars…">
          {findLabel}
        </Button>
      </div>
    </form>
  );
}

/** What the registration screens (08 and 10) take, in the revamp's frame (5.4b, decision 2) */
export interface PlateViewProps {
  plate: string;
  onPlate: (plate: string) => void;
  onFind: () => void;
  error?: string;
  finding: boolean;
  loadError: React.ReactNode;
  onManual: () => void;
  tabs: React.ReactNode;
  aside: React.ReactNode;
  onBack: () => void;
}

/** Screen 08 (Figma 226:624), in the revamp's frame as it is (5.4b, decision 2) */
export function PlateLookup({
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
  return (
    <JourneyPage
      heading={
        <StepHeading
          overline="Car insurance / Your details"
          title="Let’s find your car"
          intro="Enter your registration and we’ll look up your car’s details."
        />
      }
      tabs={tabs}
      aside={aside}
    >
      <div className="quote-panel">
        <PlateBox
          plate={plate}
          onPlate={onPlate}
          onFind={onFind}
          error={error}
          hint="Enter the registration exactly as it appears on your number plate."
          finding={finding}
          findLabel="Find my car"
          showDemoPlates
        />
        {loadError}
        <button type="button" className="quote-link" onClick={onManual}>
          I don&rsquo;t know the registration
        </button>
      </div>
      <section className="quote-aside" aria-labelledby="no-reg">
        <h2 id="no-reg" className="kb-h3">
          No registration to hand?
        </h2>
        <p>
          You can choose the make, model, year and variant instead. Check the details against your
          vehicle documents before continuing.
        </p>
        <Button variant="secondary" onClick={onManual}>
          Choose my car manually
        </Button>
      </section>
      <StepNav onBack={onBack} />
    </JourneyPage>
  );
}

export function CatalogueError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert tone="warning" announce>
      <p>We couldn&rsquo;t load the list of cars. Try again in a moment.</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  );
}
