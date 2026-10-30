import { useId, type ButtonHTMLAttributes, type Ref } from "react";

import { Badge } from "#/components/display/Badge";
import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

export interface CoverageFeature {
  label: string;
  included?: boolean;
}

export interface CoverageOptionProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "name" | "role"
> {
  /** Plan name; names the option. */
  name: string;
  description?: string;
  /** Pre-formatted price, e.g. "£38.20". */
  price?: string;
  /** Default "/month". */
  period?: string;
  /** Strings are included. Objects with included: false render muted with a minus. */
  features?: Array<string | CoverageFeature>;
  selected?: boolean;
  /** Marker badge above the card, e.g. "Most chosen". */
  flag?: string;
  onSelect?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Selectable plan card with price and features. Use inside a CoverageGroup, which gives the set
 * radio-group keyboard behaviour. Named by the plan; the flag, price, description and features
 * are its description (a button's contents aren't read as a list).
 */
export function CoverageOption({
  name,
  description,
  price,
  period = "/month",
  features = [],
  selected = false,
  flag,
  onSelect,
  className,
  ...rest
}: CoverageOptionProps) {
  const id = useId();
  const describedBy = [
    flag && `${id}-flag`,
    price != null && `${id}-price`,
    description && `${id}-desc`,
    features.length > 0 && `${id}-features`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={`${id}-name`}
      aria-describedby={describedBy || undefined}
      onClick={onSelect}
      className={cx("kb-cover", selected && "kb-cover--selected", className)}
      {...rest}
    >
      {flag ? (
        <Badge tone="accent" className="kb-cover__flag" id={`${id}-flag`}>
          {flag}
        </Badge>
      ) : null}
      <span className="kb-cover__head">
        <span>
          <span className="kb-cover__name" id={`${id}-name`}>
            {name}
          </span>
          {description ? (
            <span className="kb-cover__desc" id={`${id}-desc`}>
              {description}
            </span>
          ) : null}
        </span>
        <span className="kb-cover__radio" aria-hidden="true" />
      </span>
      {price != null ? (
        <span className="kb-cover__price" id={`${id}-price`}>
          <span className="kb-cover__amount">{price}</span>
          <span className="kb-cover__period">{period}</span>
        </span>
      ) : null}
      {features.length ? (
        <ul className="kb-cover__list" id={`${id}-features`}>
          {features.map((feature, i) => {
            const item = typeof feature === "string" ? { label: feature, included: true } : feature;
            const off = item.included === false;
            return (
              <li key={i} className={off ? "is-off" : undefined}>
                <Icon
                  name={off ? "minus" : "check"}
                  size={18}
                  color={off ? "var(--fg-4)" : "var(--green-600)"}
                />
                <span>
                  {off ? <span className="kb-sr-only">Not included: </span> : null}
                  {item.label}
                  {/* Separates features when read as one description */}
                  <span className="kb-sr-only">. </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </button>
  );
}
