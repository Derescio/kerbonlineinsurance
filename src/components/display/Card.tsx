import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "#/lib/cx";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** raised (default, white + shadow-1), outline (hairline only), sunken (stone-100), inverse (evergreen). */
  variant?: "raised" | "outline" | "sunken" | "inverse";
  /** none 0, sm 16, md 24 (default), lg 32. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Hover lift + pointer. Use when the whole card navigates: use as="a", or put a real link inside. */
  interactive?: boolean;
  /** Element to render as. Default "div". */
  as?: "div" | "section" | "article" | "li" | "a";
  /** Only with as="a". */
  href?: string;
  children?: ReactNode;
}

/** Surface container. 16px radius; raised = hairline + soft shadow. */
export function Card({
  variant = "raised",
  padding = "md",
  interactive = false,
  as: Element = "div",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      className={cx(
        "kb-card",
        `kb-card--${variant}`,
        padding !== "md" && `kb-card--pad-${padding}`,
        interactive && "kb-card--interactive",
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}
