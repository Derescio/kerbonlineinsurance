import { useId, type ReactNode } from "react";

import { cx } from "#/lib/cx";

import { describedBy, FieldMessage, OptionalMark, type FieldMessageProps } from "./Field";

export interface RadioGroupProps extends FieldMessageProps {
  /** The question, announced with each option: "How do you want to pay?" */
  legend: string;
  /** Radio components sharing one `name`. Arrow keys move between them (native behaviour). */
  children: ReactNode;
  className?: string;
}

/** Fieldset + legend around a set of radios, with an optional hint or error. */
export function RadioGroup({
  legend,
  hint,
  error,
  optional,
  children,
  className,
}: RadioGroupProps) {
  const id = useId();
  return (
    <fieldset
      className={cx("kb-fieldset", className)}
      aria-describedby={describedBy(id, { hint, error })}
    >
      <legend className="kb-field__label">
        {legend}
        <OptionalMark optional={optional} />
      </legend>
      <div className="kb-fieldset__options">{children}</div>
      <FieldMessage id={id} hint={hint} error={error} />
    </fieldset>
  );
}
