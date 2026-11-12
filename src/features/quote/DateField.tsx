import { useId } from "react";

import { describedBy, FieldMessage } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";

import { isoFromParts } from "./schemas/dates";

// A date as three boxes, day, month and year (5.3, call 14): the GOV.UK pattern. Easy to type on
// a phone, easy to label for a screen reader, and no picker to fight.

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

export const emptyDate: DateParts = { day: "", month: "", year: "" };

/** The boxes for a stored ISO date */
export function partsOf(iso: string | undefined): DateParts {
  if (!iso) return emptyDate;
  const [year = "", month = "", day = ""] = iso.split("-");
  return { day: String(Number(day)), month: String(Number(month)), year };
}

/** The ISO date the boxes make, or "" (so the schema says "Enter a date…") */
export function isoOf(parts: DateParts): string {
  return isoFromParts(parts.day, parts.month, parts.year) ?? "";
}

export function DateField({
  legend,
  hint,
  error,
  value,
  onChange,
  birthday = false,
}: {
  legend: string;
  hint?: string;
  error?: string;
  value: DateParts;
  onChange: (value: DateParts) => void;
  /** A date of birth: lets the browser offer the saved one */
  birthday?: boolean;
}) {
  const id = useId();
  const invalid = error ? true : undefined;
  const box = (part: keyof DateParts, label: string, width: "short" | "long") => (
    <Input
      label={label}
      inputMode="numeric"
      autoComplete={birthday ? `bday-${part}` : "off"}
      maxLength={part === "year" ? 4 : 2}
      className={`quote-date__${width}`}
      value={value[part]}
      aria-invalid={invalid}
      aria-describedby={describedBy(id, { hint, error })}
      onChange={(e) => onChange({ ...value, [part]: e.target.value })}
    />
  );
  return (
    <fieldset
      className="kb-fieldset quote-date"
      aria-describedby={describedBy(id, { hint, error })}
    >
      <legend className="kb-field__label">{legend}</legend>
      <div className="quote-date__boxes">
        {box("day", "Day", "short")}
        {box("month", "Month", "short")}
        {box("year", "Year", "long")}
      </div>
      <FieldMessage id={id} hint={hint} error={error} />
    </fieldset>
  );
}
