import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "#/lib/cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

export interface TabsProps {
  /** Links the tabs to their TabPanels: pass the same id as `tabsId` on each panel. */
  id: string;
  /** Names the tab list, e.g. "Policy sections". */
  label: string;
  items: Array<string | TabItem>;
  /** Selected item id. */
  value: string;
  onChange: (id: string) => void;
  /** underline (page sections) or pill (segmented switch). */
  variant?: "underline" | "pill";
  /** Stretch tabs to fill the width. */
  fullWidth?: boolean;
  className?: string;
}

const tabId = (tabsId: string, id: string) => `${tabsId}-tab-${id}`;
const panelId = (tabsId: string, id: string) => `${tabsId}-panel-${id}`;

/**
 * Tab strip (WAI-ARIA tabs pattern, automatic activation): only the selected tab is in the Tab
 * order; ←/→ move and select (wrapping), Home/End jump to the ends.
 */
export function Tabs({
  id,
  label,
  items,
  value,
  onChange,
  variant = "underline",
  fullWidth = false,
  className,
}: TabsProps) {
  const tabs = items.map((item) => (typeof item === "string" ? { id: item, label: item } : item));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = targets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next]!.id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx("kb-tabs", `kb-tabs--${variant}`, fullWidth && "kb-tabs--full", className)}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(id, tab.id)}
            tabIndex={selected ? 0 : -1}
            className="kb-tab"
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
            {tab.count != null ? <span className="kb-tab__count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** The `id` given to Tabs. */
  tabsId: string;
  /** The tab this panel belongs to. */
  value: string;
  children: ReactNode;
}

/** Content for one tab. Render only the selected one, or render all and hide the others. */
export function TabPanel({ tabsId, value, children, ...rest }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      tabIndex={0}
      {...rest}
    >
      {children}
    </div>
  );
}
