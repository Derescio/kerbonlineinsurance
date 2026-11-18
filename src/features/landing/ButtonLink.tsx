import { Link } from "@tanstack/react-router";
import type { MouseEventHandler, ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import type { ProductId } from "#/features/quote/products";
import { cx } from "#/lib/cx";

export interface ButtonLinkProps {
  /** `?type=` for the quote start; none opens it with nothing picked */
  search?: { type?: ProductId };
  variant: "primary" | "accent";
  size: "sm" | "lg";
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/**
 * A link to the quote start that looks like `Button` with an arrow, for the landing's quote CTAs.
 * A router <Link> since /quote landed (5.1), so it's preloaded on hover and opens without a reload.
 */
export function ButtonLink({
  search,
  variant,
  size,
  className,
  children,
  onClick,
}: ButtonLinkProps) {
  return (
    <Link
      to="/quote"
      search={search ?? {}}
      className={cx("kb-btn", `kb-btn--${variant}`, `kb-btn--${size}`, className)}
      onClick={onClick}
    >
      <span>{children}</span>
      <Icon name="arrow-right" size={size === "sm" ? 16 : 18} />
    </Link>
  );
}
