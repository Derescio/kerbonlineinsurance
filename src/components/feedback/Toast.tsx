import type { HTMLAttributes, ReactNode } from "react";

import { IconButton } from "#/components/actions/IconButton";
import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

import { toneIcons, type FeedbackTone } from "./Alert";

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role"> {
  tone?: FeedbackTone;
  title?: ReactNode;
  message?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

/**
 * Transient confirmation on an evergreen surface. Presentational: show it with `useToast()`, which
 * puts it in the Toaster's live region so it's announced.
 */
export function Toast({
  tone = "success",
  title,
  message,
  actionLabel,
  onAction,
  onClose,
  className,
  ...rest
}: ToastProps) {
  return (
    <div className={cx("kb-toast", `kb-toast--${tone}`, className)} {...rest}>
      <Icon name={toneIcons[tone]} size={20} className="kb-toast__icon" />
      <div className="kb-toast__body">
        {title ? <span className="kb-toast__title">{title}</span> : null}
        {message ? <span className="kb-toast__msg">{message}</span> : null}
      </div>
      {actionLabel ? (
        <button type="button" className="kb-toast__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <IconButton icon="x" label="Dismiss" size="sm" variant="inverse" onClick={onClose} />
      ) : null}
    </div>
  );
}
