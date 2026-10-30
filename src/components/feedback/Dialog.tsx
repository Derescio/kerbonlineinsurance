import { useEffect, useId, useRef, type ReactNode } from "react";

import { IconButton } from "#/components/actions/IconButton";
import { cx } from "#/lib/cx";

export interface DialogProps {
  open: boolean;
  /** Called on Escape, scrim click or the close button. Omit to make it non-dismissable. */
  onClose?: () => void;
  /** Names the dialog. */
  title: ReactNode;
  /** Describes the dialog; read when it opens. */
  description?: ReactNode;
  /** Button row, right-aligned (stacked full-width in sheets). */
  actions?: ReactNode;
  /** sm 380, md 480, lg 640. */
  size?: "sm" | "md" | "lg";
  /** "modal" centred (web), "sheet" bottom sheet (mobile). */
  presentation?: "modal" | "sheet";
  /** Non-modal preview inside the nearest positioned ancestor (docs and /system only). */
  contained?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Modal dialog or bottom sheet over a blurred evergreen scrim. Built on the native <dialog> with
 * showModal(), so the browser traps focus, makes the page behind inert, handles Escape and puts
 * focus back on the opener when it closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  actions,
  size = "md",
  presentation = "modal",
  contained = false,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const sheet = presentation === "sheet";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || contained) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, contained]);

  const panel = (
    <div
      className={cx("kb-dialog", size !== "md" && `kb-dialog--${size}`, className)}
      {...(contained
        ? {
            role: "dialog",
            "aria-labelledby": `${id}-title`,
            "aria-describedby": description ? `${id}-description` : undefined,
          }
        : {})}
    >
      {sheet ? <div className="kb-dialog__grab" aria-hidden="true" /> : null}
      {onClose && !sheet ? (
        <IconButton
          icon="x"
          label="Close"
          size="sm"
          className="kb-dialog__close"
          onClick={onClose}
        />
      ) : null}
      <h2 className="kb-dialog__title" id={`${id}-title`}>
        {title}
      </h2>
      {description ? (
        <p className="kb-dialog__desc" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      {children ? <div className="kb-dialog__body">{children}</div> : null}
      {actions ? <div className="kb-dialog__actions">{actions}</div> : null}
    </div>
  );

  const scrimClass = cx(
    "kb-dialog-scrim",
    contained && "kb-dialog-scrim--contained",
    sheet && "kb-dialog-scrim--sheet",
  );

  if (contained) {
    return open ? <div className={scrimClass}>{panel}</div> : null;
  }

  return (
    <dialog
      ref={ref}
      className={scrimClass}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      // Escape: ask the owner to close; without onClose the dialog stays put
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      // The browser can still close it (e.g. a second Escape). Keep it in step with `open`.
      onClose={() => {
        if (!open) return;
        if (onClose) onClose();
        else ref.current?.showModal();
      }}
      // mousedown, not click, so a drag that starts inside the panel doesn't close it
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {panel}
    </dialog>
  );
}
