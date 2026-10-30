import { useId, type ComponentPropsWithRef } from "react";

import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

import { describedBy, Field, type FieldMessageProps } from "./Field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends ComponentPropsWithRef<"select">, FieldMessageProps {
  label?: string;
  /** Strings or {value, label} pairs. */
  options: Array<string | SelectOption>;
  /** Disabled first option shown until a value is picked. Doesn't make the field required. */
  placeholder?: string;
}

/** Native select styled as a Kerb control. */
export function Select({
  label,
  hint,
  error,
  optional,
  options,
  placeholder,
  disabled,
  id,
  value,
  defaultValue,
  className,
  style,
  ...rest
}: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  // Uncontrolled with a placeholder: start on the placeholder
  const initial =
    value === undefined && defaultValue === undefined && placeholder ? "" : defaultValue;
  return (
    <Field id={fieldId} label={label} optional={optional} hint={hint} error={error}>
      <div
        className={cx(
          "kb-control",
          error && "kb-control--error",
          disabled && "kb-control--disabled",
          className,
        )}
        style={style}
      >
        <select
          id={fieldId}
          disabled={disabled}
          value={value}
          defaultValue={initial}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, { hint, error })}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} className="kb-control__chev" />
      </div>
    </Field>
  );
}
