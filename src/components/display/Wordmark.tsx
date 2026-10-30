import type { HTMLAttributes } from "react";

import { cx } from "#/lib/cx";

export interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** Font size in px (cap height scales with it). Default 28. */
  size?: number;
  /** "ink" on light surfaces, "inverse" on evergreen / dark. */
  tone?: "ink" | "inverse";
  /** Optional mono descriptor, e.g. "car insurance". */
  descriptor?: string;
}

/** Typeset Kerb wordmark: lowercase "kerb" in Bricolage Grotesque 800 + a square full stop. */
export function Wordmark({
  size = 28,
  tone = "ink",
  descriptor,
  className,
  style,
  ...rest
}: WordmarkProps) {
  return (
    <span
      role="img"
      aria-label={descriptor ? `Kerb ${descriptor}` : "Kerb"}
      className={cx("kb-wordmark", tone === "inverse" && "kb-wordmark--inverse", className)}
      style={{ fontSize: size, ...style }}
      {...rest}
    >
      <span aria-hidden="true">kerb</span>
      <span className="kb-wordmark__dot" aria-hidden="true" />
      {descriptor ? (
        <span className="kb-wordmark__desc" aria-hidden="true">
          {descriptor}
        </span>
      ) : null}
    </span>
  );
}
