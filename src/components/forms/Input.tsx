import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { cx } from "#/lib/cx";

import { describedBy, Field, type FieldMessageProps } from "./Field";

export interface InputProps
  extends Omit<ComponentPropsWithRef<"input">, "prefix">, FieldMessageProps {
  /** Always give a visible label. */
  label?: string;
  /** Icon inside the control, left. */
  iconLeft?: IconName;
  /** Text before the value, e.g. "£". */
  prefix?: ReactNode;
  /** Text after the value, e.g. "miles". */
  suffix?: ReactNode;
  /** "plate" is the yellow number-plate field (mono, uppercase, 56px). */
  variant?: "default" | "plate";
}

/** Labelled text input with hint or error, optional icon and affixes. 48px tall, 12px radius. */
export function Input({
  label,
  hint,
  error,
  optional,
  iconLeft,
  prefix,
  suffix,
  variant = "default",
  disabled,
  id,
  className,
  style,
  ...rest
}: InputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} optional={optional} hint={hint} error={error}>
      <div
        className={cx(
          "kb-control",
          variant === "plate" && "kb-control--plate",
          error && "kb-control--error",
          disabled && "kb-control--disabled",
          className,
        )}
        style={style}
      >
        {iconLeft ? <Icon name={iconLeft} size={18} /> : null}
        {prefix ? <span className="kb-control__affix">{prefix}</span> : null}
        <input
          id={fieldId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, { hint, error })}
          {...rest}
        />
        {suffix ? <span className="kb-control__affix">{suffix}</span> : null}
      </div>
    </Field>
  );
}
