import type { MouseEvent, ReactNode } from "react";

import { cx } from "#/lib/cx";

import { Icon } from "./Icon";
import type { IconName } from "./icons";

export interface TagProps {
  selected?: boolean;
  /** Icon shown before the label. */
  icon?: IconName;
  /** Makes the tag a toggle button (aria-pressed follows `selected`). */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Shows an × button. A removable tag isn't also a toggle. */
  onRemove?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}

/**
 * Chip for filters and quick picks. A toggleable tag is a real button; a removable tag is a label
 * with its own remove button, so interactive controls are never nested.
 */
export function Tag({ selected = false, icon, onClick, onRemove, className, children }: TagProps) {
  const content = (
    <>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </>
  );
  const classes = cx("kb-tag", selected && "kb-tag--selected", className);

  if (onRemove) {
    const label = typeof children === "string" ? children : undefined;
    return (
      <span className={cx(classes, "kb-tag--static")}>
        {content}
        <button
          type="button"
          className="kb-tag__remove"
          aria-label={label ? `Remove ${label}` : "Remove"}
          onClick={onRemove}
        >
          <Icon name="x" size={14} />
        </button>
      </span>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={classes} aria-pressed={selected} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <span className={cx(classes, "kb-tag--static")}>{content}</span>;
}
