import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { cx } from "#/lib/cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Primary = evergreen; accent = Marker yellow, at most one per view. */
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  /** sm 36px, md 44px (default), lg 52px. */
  size?: "sm" | "md" | "lg";
  /** Icon before the label. */
  iconLeft?: IconName;
  /** Icon after the label (e.g. "arrow-right" for forward steps). */
  iconRight?: IconName;
  fullWidth?: boolean;
  /** Swaps the left icon for a spinner and disables the button. The label stays, so the width holds. */
  loading?: boolean;
  children?: ReactNode;
}

/** Pill button. Labels are verbs in sentence case: "Start a claim". */
export function Button({
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  fullWidth = false,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = size === "sm" ? 16 : 18;
  return (
    <button
      type={type}
      className={cx(
        "kb-btn",
        `kb-btn--${variant}`,
        `kb-btn--${size}`,
        fullWidth && "kb-btn--full",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="kb-spinner" aria-hidden="true" />
      ) : iconLeft ? (
        <Icon name={iconLeft} size={iconSize} />
      ) : null}
      {children != null ? <span>{children}</span> : null}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}
