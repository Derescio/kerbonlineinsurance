import { useEffect, useId, useState, type ReactNode } from "react";

import { cx } from "#/lib/cx";

export interface TooltipProps {
  /** The explanation, e.g. what "excess" means. */
  content: ReactNode;
  placement?: "top" | "bottom";
  /** Force visible (docs, onboarding). */
  open?: boolean;
  /** The term being explained. Rendered as the trigger button, so it's reachable with Tab. */
  children: ReactNode;
  className?: string;
}

/**
 * Hover/focus explainer for insurance jargon. The trigger is described by the bubble, and Escape
 * hides the bubble until the next hover or focus (WCAG 1.4.13).
 */
export function Tooltip({
  content,
  placement = "top",
  open = false,
  children,
  className,
}: TooltipProps) {
  const id = useId();
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Escape works while hovered too, not only while the trigger has focus
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const show = () => {
    setActive(true);
    setDismissed(false);
  };
  const hide = () => setActive(false);

  return (
    <span
      className={cx(
        "kb-tip",
        placement === "bottom" && "kb-tip--bottom",
        open && "kb-tip--open",
        dismissed && "kb-tip--dismissed",
        className,
      )}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        className="kb-tip__trigger"
        aria-describedby={id}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </button>
      <span role="tooltip" id={id} className="kb-tip__bubble">
        {content}
      </span>
    </span>
  );
}
