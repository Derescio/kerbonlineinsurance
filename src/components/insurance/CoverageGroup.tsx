import { useRef, type KeyboardEvent } from "react";

import { cx } from "#/lib/cx";

import { CoverageOption, type CoverageOptionProps } from "./CoverageOption";

export interface CoverageChoice extends Omit<
  CoverageOptionProps,
  "selected" | "onSelect" | "onKeyDown" | "tabIndex" | "ref"
> {
  id: string;
}

export interface CoverageGroupProps {
  /** Names the group: "Choose your cover". */
  label: string;
  options: CoverageChoice[];
  /** Selected option id, or null before a choice. */
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}

const NEXT = ["ArrowDown", "ArrowRight"];
const PREVIOUS = ["ArrowUp", "ArrowLeft"];

/**
 * Plan cards that behave as one radio group (WAI-ARIA radio group pattern): one card in the Tab
 * order, arrow keys move and select (wrapping), Space selects the focused card.
 */
export function CoverageGroup({ label, options, value, onChange, className }: CoverageGroupProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((o) => o.id === value);
  const tabbable = selectedIndex === -1 ? 0 : selectedIndex;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (NEXT.includes(e.key)) next = (index + 1) % options.length;
    else if (PREVIOUS.includes(e.key)) next = (index - 1 + options.length) % options.length;
    else if (e.key === " ") {
      e.preventDefault();
      onChange(options[index]!.id);
      return;
    } else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next]!.id);
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx("kb-cover-group", className)}>
      {options.map(({ id, ...option }, i) => (
        <CoverageOption
          key={id}
          {...option}
          ref={(el) => {
            refs.current[i] = el;
          }}
          selected={id === value}
          tabIndex={i === tabbable ? 0 : -1}
          onSelect={() => onChange(id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        />
      ))}
    </div>
  );
}
