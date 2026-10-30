import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  label?: ReactNode;
  /** Smaller line under the label, read out with it. */
  description?: ReactNode;
}

/** Checkbox with label and optional description. Controlled or uncontrolled via native props. */
export function Checkbox({
  label,
  description,
  disabled,
  className,
  style,
  ...rest
}: CheckboxProps) {
  const id = useId();
  return (
    <label className={cx("kb-check", disabled && "kb-check--disabled", className)} style={style}>
      <input
        type="checkbox"
        disabled={disabled}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-describedby={description ? `${id}-description` : undefined}
        {...rest}
      />
      <span className="kb-check__box">
        <Icon name="check" size={14} />
      </span>
      <CheckText id={id} label={label} description={description} />
    </label>
  );
}

/**
 * Label + description column shared by Checkbox and Radio. The input is named by the label text
 * only (aria-labelledby), so the description isn't read twice.
 */
export function CheckText({
  id,
  label,
  description,
}: {
  id: string;
  label?: ReactNode;
  description?: ReactNode;
}) {
  if (!label && !description) return null;
  return (
    <span className="kb-check__text">
      {label ? <span id={`${id}-label`}>{label}</span> : null}
      {description ? (
        <span className="kb-check__desc" id={`${id}-description`}>
          {description}
        </span>
      ) : null}
    </span>
  );
}
