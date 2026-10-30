import type { ButtonHTMLAttributes } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { cx } from "#/lib/cx";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Accessible name (also the native tooltip). */
  label: string;
  variant?: "ghost" | "secondary" | "primary" | "inverse";
  /** sm 32, md 40 (default), lg 48. */
  size?: "sm" | "md" | "lg";
}

/** Circular icon-only button. */
export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  type = "button",
  className,
  ...rest
}: IconButtonProps) {
  const iconSize = size === "sm" ? 16 : size === "lg" ? 22 : 20;
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "kb-iconbtn",
        `kb-iconbtn--${variant}`,
        size !== "md" && `kb-iconbtn--${size}`,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
