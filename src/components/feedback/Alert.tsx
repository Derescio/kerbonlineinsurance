import type { HTMLAttributes, ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { cx } from "#/lib/cx";

export type FeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";

export const toneIcons: Record<FeedbackTone, IconName> = {
  neutral: "info",
  info: "info",
  success: "circle-check",
  warning: "triangle-alert",
  danger: "circle-alert",
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role"> {
  tone?: FeedbackTone;
  title?: ReactNode;
  /** Overrides the tone's icon. */
  icon?: IconName;
  /** Action row, e.g. a small ghost Button. */
  action?: ReactNode;
  /**
   * Set when the alert appears because of something the user just did, so screen readers
   * announce it (danger → role="alert", others → role="status"). Leave off for alerts that are
   * part of the page when it loads; they're read in place.
   */
  announce?: boolean;
  children?: ReactNode;
}

/** Inline, persistent message with a tinted background and hairline border. */
export function Alert({
  tone = "info",
  title,
  icon,
  action,
  announce = false,
  className,
  children,
  ...rest
}: AlertProps) {
  const role = announce ? (tone === "danger" ? "alert" : "status") : undefined;
  return (
    <div
      role={role}
      className={cx("kb-alert", tone !== "neutral" && `kb-alert--${tone}`, className)}
      {...rest}
    >
      <Icon name={icon ?? toneIcons[tone]} size={20} className="kb-alert__icon" />
      <div className="kb-alert__body">
        {title ? <span className="kb-alert__title">{title}</span> : null}
        {children}
        {action ? <div className="kb-alert__action">{action}</div> : null}
      </div>
    </div>
  );
}
