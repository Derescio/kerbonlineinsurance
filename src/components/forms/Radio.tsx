import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cx } from "#/lib/cx";

import { CheckText } from "./Checkbox";

export interface RadioProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  label?: ReactNode;
  /** Smaller line under the label, read out with it (e.g. "12 payments of £38.20"). */
  description?: ReactNode;
}

/** One radio with its label. Put a set in a RadioGroup with the same `name`. */
export function Radio({ label, description, disabled, className, style, ...rest }: RadioProps) {
  const id = useId();
  return (
    <label
      className={cx("kb-check", "kb-check--radio", disabled && "kb-check--disabled", className)}
      style={style}
    >
      <input
        type="radio"
        disabled={disabled}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-describedby={description ? `${id}-description` : undefined}
        {...rest}
      />
      <span className="kb-check__box" />
      <CheckText id={id} label={label} description={description} />
    </label>
  );
}
