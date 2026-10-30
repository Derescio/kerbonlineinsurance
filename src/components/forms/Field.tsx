import type { ReactNode } from "react";

import { Icon } from "#/components/display/Icon";

export interface FieldMessageProps {
  /** Shown under the control. Replaced by `error` when there is one. */
  hint?: string;
  /** Says what to do: "Enter your postcode", not "Invalid input". */
  error?: string;
  /** Appends "(optional)" to the label. */
  optional?: boolean;
}

/** The id of the hint or error that describes a control, for `aria-describedby`. */
export function describedBy(id: string, { hint, error }: FieldMessageProps) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export function FieldMessage({ id, hint, error }: { id: string } & FieldMessageProps) {
  if (error) {
    return (
      <span className="kb-field__error" id={`${id}-error`}>
        <Icon name="circle-alert" size={14} />
        {error}
      </span>
    );
  }
  if (hint) {
    return (
      <span className="kb-field__hint" id={`${id}-hint`}>
        {hint}
      </span>
    );
  }
  return null;
}

export function OptionalMark({ optional }: { optional?: boolean }) {
  return optional ? <span className="kb-field__optional"> (optional)</span> : null;
}

interface FieldProps extends FieldMessageProps {
  /** The control's id; the label points at it. */
  id: string;
  label?: string;
  children: ReactNode;
}

/** Label, control, then hint or error. Shared by Input and Select. */
export function Field({ id, label, optional, hint, error, children }: FieldProps) {
  return (
    <div className="kb-field">
      {label ? (
        <label className="kb-field__label" htmlFor={id}>
          {label}
          <OptionalMark optional={optional} />
        </label>
      ) : null}
      {children}
      <FieldMessage id={id} hint={hint} error={error} />
    </div>
  );
}
