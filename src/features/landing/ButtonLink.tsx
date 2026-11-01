import type { MouseEventHandler, ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

export interface ButtonLinkProps {
  href: string;
  variant: "primary" | "accent";
  size: "sm" | "lg";
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/**
 * A link that looks like `Button` with an arrow, for the landing's quote CTAs. Plain <a>, like the
 * chrome links: /quote isn't a route until Phase 5 (src/components/site/links.ts).
 */
export function ButtonLink({ href, variant, size, className, children, onClick }: ButtonLinkProps) {
  return (
    <a
      href={href}
      className={cx("kb-btn", `kb-btn--${variant}`, `kb-btn--${size}`, className)}
      onClick={onClick}
    >
      <span>{children}</span>
      <Icon name="arrow-right" size={size === "sm" ? 16 : 18} />
    </a>
  );
}
