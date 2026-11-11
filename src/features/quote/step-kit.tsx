import type { ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Radio } from "#/components/forms/Radio";
import { RadioGroup } from "#/components/forms/RadioGroup";

import type { Journey } from "./journey-store";

// Pieces the four driver steps share (5.3): the heading, a Yes/No question, the Back and Continue
// row, and the props every step takes.

export interface StepProps {
  journey: Journey;
  /** London date, `todayIso()`; the schemas check against it */
  today: string;
  /** Show the stored answers' errors on open: the step was reopened because an edit broke it */
  revalidate?: boolean;
  onBack: () => void;
  /** Called after the step's answers are saved */
  onDone: () => void;
}

/** A form's field errors, keyed by zod path (`drivers.0.firstName`) */
export type Errors = Record<string, string | undefined>;

export function StepHeading({
  overline,
  title,
  intro,
}: {
  overline: string;
  title: string;
  intro?: ReactNode;
}) {
  return (
    <header className="quote-heading">
      <p className="quote-heading__overline">{overline}</p>
      <h1 className="kb-h1 quote-heading__title" tabIndex={-1}>
        {title}
      </h1>
      {intro ? <p className="quote-heading__intro">{intro}</p> : null}
    </header>
  );
}

/** A Yes/No question. The radios carry aria-invalid, so focusFirstError can land on them. */
export function YesNo({
  name,
  legend,
  hint,
  value,
  error,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: string;
  value: boolean | undefined;
  error?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <RadioGroup legend={legend} hint={hint} error={error} className="quote-yesno">
      <Radio
        name={name}
        label="Yes"
        checked={value === true}
        aria-invalid={error ? true : undefined}
        onChange={() => onChange(true)}
      />
      <Radio
        id={`${name}-no`}
        name={name}
        label="No"
        checked={value === false}
        onChange={() => onChange(false)}
      />
    </RadioGroup>
  );
}

export function StepActions({ onBack, submit }: { onBack: () => void; submit: string }) {
  return (
    <div className="quote-nav">
      <button type="button" className="quote-link" onClick={onBack}>
        Back
      </button>
      <Button type="submit" variant="accent">
        {submit}
      </Button>
    </div>
  );
}

/** A whole number as the box shows it; empty for none */
export function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** "" for an unanswered choice, so zod gets undefined and its "Choose…" message */
export function chosen<T extends string>(value: T | ""): T | undefined {
  return value === "" ? undefined : value;
}
