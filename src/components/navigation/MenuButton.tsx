import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cx } from "#/lib/cx";

// A button that opens a short list of links and actions (6.1): the public header's "My account"
// and the account header's avatar. A disclosure, not an ARIA menu: Tab moves through the items,
// Escape or a click elsewhere closes it, and focus goes back to the button on Escape.

export type MenuItem =
  | { label: string; href: string }
  | { label: string; onSelect: () => void | Promise<void> };

export interface MenuButtonProps {
  /** What the button shows; `accessibleName` names it when this is only initials or an icon */
  children: ReactNode;
  accessibleName?: string;
  items: MenuItem[];
  /** The button's look, as kb-btn classes, e.g. "kb-btn kb-btn--secondary kb-btn--sm" */
  buttonClassName: string;
  className?: string;
}

export function MenuButton({
  children,
  accessibleName,
  items,
  buttonClassName,
  className,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div ref={root} className={cx("kb-menu", className)} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        aria-label={accessibleName}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {children}
      </button>
      <ul id={panelId} className="kb-menu__panel" hidden={!open}>
        {items.map((item) => (
          <li key={item.label}>
            {"href" in item ? (
              <a href={item.href} className="kb-menu__item">
                {item.label}
              </a>
            ) : (
              <button
                type="button"
                className="kb-menu__item"
                onClick={() => {
                  setOpen(false);
                  void item.onSelect();
                }}
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
