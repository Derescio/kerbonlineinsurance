import { Fragment } from "react";

import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

export interface StepperProps {
  /** Step labels in order. */
  steps: string[];
  /** Zero-based index of the current step. */
  current: number;
  /** default: dots + all labels. compact: only the current label shows. bar: segmented bar (mobile). */
  variant?: "default" | "compact" | "bar";
  /** Names the stepper, e.g. "Quote progress". */
  label?: string;
  className?: string;
}

type StepState = "done" | "current" | "upcoming";

/** Progress through a multi-step journey (quote, claim). */
export function Stepper({
  steps,
  current,
  variant = "default",
  label = "Progress",
  className,
}: StepperProps) {
  const state = (i: number): StepState =>
    i < current ? "done" : i === current ? "current" : "upcoming";

  if (variant === "bar") {
    return (
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
        aria-valuetext={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
        className={cx("kb-stepper", "kb-stepper--bar", className)}
      >
        {steps.map((_, i) => (
          <span key={i} className={`kb-bar kb-bar--${state(i)}`} />
        ))}
      </div>
    );
  }

  return (
    <nav aria-label={label}>
      <ol className={cx("kb-stepper", variant === "compact" && "kb-stepper--compact", className)}>
        {steps.map((step, i) => {
          const s = state(i);
          return (
            <Fragment key={i}>
              {i > 0 ? (
                <li
                  aria-hidden="true"
                  className={cx("kb-stepper__line", i <= current && "kb-stepper__line--done")}
                />
              ) : null}
              <li
                className={`kb-step kb-step--${s}`}
                aria-current={s === "current" ? "step" : undefined}
              >
                <span className="kb-step__dot" aria-hidden="true">
                  {s === "done" ? <Icon name="check" size={14} /> : i + 1}
                </span>
                {/* compact hides the label visually only, so it's still read */}
                <span
                  className={cx(
                    "kb-step__label",
                    variant === "compact" && s !== "current" && "kb-sr-only",
                  )}
                >
                  {step}
                </span>
                {s === "done" ? <span className="kb-sr-only"> (completed)</span> : null}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
