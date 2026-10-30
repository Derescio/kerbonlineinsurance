import type { HTMLAttributes, ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

export type TimelineStatus = "done" | "current" | "upcoming";

export interface TimelineItem {
  title: ReactNode;
  /** Date/time or owner, e.g. "Today, 09:12". */
  meta?: ReactNode;
  description?: ReactNode;
  status?: TimelineStatus;
}

export interface TimelineProps extends HTMLAttributes<HTMLOListElement> {
  items: TimelineItem[];
}

// The node and colour show status visually; this says it to screen readers
const statusText: Record<TimelineStatus, string> = {
  done: "Done: ",
  current: "In progress: ",
  upcoming: "Next: ",
};

/** Vertical status timeline for claim progress. */
export function Timeline({ items, className, ...rest }: TimelineProps) {
  return (
    <ol className={cx("kb-timeline", className)} {...rest}>
      {items.map((item, i) => {
        const status = item.status ?? "upcoming";
        return (
          <li
            key={i}
            className={`kb-tl kb-tl--${status}`}
            aria-current={status === "current" ? "step" : undefined}
          >
            <span className="kb-tl__node">
              {status === "done" ? <Icon name="check" size={14} /> : null}
            </span>
            <div>
              <div className="kb-tl__title">
                <span className="kb-sr-only">{statusText[status]}</span>
                {item.title}
              </div>
              {item.meta ? <div className="kb-tl__meta">{item.meta}</div> : null}
              {item.description ? <div className="kb-tl__desc">{item.description}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
