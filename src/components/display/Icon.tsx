import type { SVGProps } from "react";

import { cx } from "#/lib/cx";

import { icons, type IconName } from "./icons";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "color" | "ref"> {
  /** Lucide icon id, kebab-case (see icons.ts). */
  name: IconName;
  /** Pixel size. 16 inline/small, 20 default, 24 nav/feature. */
  size?: number;
  /** CSS colour; defaults to currentColor. */
  color?: string;
  /** Accessible label. Omit for decorative icons (aria-hidden). */
  label?: string;
}

/** Lucide glyph as inline SVG, in currentColor. */
export function Icon({ name, size = 20, color, label, className, ...rest }: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      color={color ?? "currentColor"}
      strokeWidth={2}
      className={cx("kb-icon", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    />
  );
}
