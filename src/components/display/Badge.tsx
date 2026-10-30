import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "#/lib/cx";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "accent" | "inverse";
  /** Leading status dot. */
  dot?: boolean;
  children?: ReactNode;
}

/** Small non-interactive status pill. */
export function Badge({ tone = "neutral", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx("kb-badge", tone !== "neutral" && `kb-badge--${tone}`, className)}
      {...rest}
    >
      {dot ? <span className="kb-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
