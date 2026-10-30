import type { ComponentPropsWithRef, ReactNode } from "react";

import { cx } from "#/lib/cx";

export interface SwitchProps extends Omit<ComponentPropsWithRef<"input">, "type" | "role"> {
  label?: ReactNode;
  /** "start": track then label. "end": label left, track pushed right (settings rows). */
  labelPosition?: "start" | "end";
}

/** On/off toggle for settings that apply straight away. Use a Checkbox for form answers. */
export function Switch({
  label,
  labelPosition = "start",
  disabled,
  className,
  style,
  ...rest
}: SwitchProps) {
  return (
    <label
      className={cx(
        "kb-switch",
        labelPosition === "end" && "kb-switch--end",
        disabled && "kb-switch--disabled",
        className,
      )}
      style={style}
    >
      <input type="checkbox" role="switch" disabled={disabled} {...rest} />
      <span className="kb-switch__track" aria-hidden="true" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
