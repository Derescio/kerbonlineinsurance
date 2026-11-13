import { useEffect, useRef, type ReactNode } from "react";

import { Card } from "#/components/display/Card";
import { Icon } from "#/components/display/Icon";
import { cx } from "#/lib/cx";

import { fuelLabel } from "./catalogue";
import { helpHref } from "./help";
import type { DetailsTab, TabState } from "./steps";

// The revamp's page parts (5.4b; Revamp 249:5806): the two-column page, the details tabs, the
// "Your car" card, the help card and the Back / next row. Every car view is laid out with them.

export function JourneyPage({
  heading,
  tabs,
  aside,
  children,
}: {
  heading: ReactNode;
  tabs?: ReactNode;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="quote-page">
      {heading}
      {tabs}
      <div className="quote-page__columns">
        <div className="quote-page__main">{children}</div>
        <aside className="quote-page__aside" aria-label="Your car and help">
          {aside}
        </aside>
      </div>
    </div>
  );
}

const tabLabels: Record<DetailsTab, string> = {
  car: "Car",
  about: "About you",
  driving: "Driving",
  claims: "Claims",
  drivers: "Drivers",
};

/** Car, About you, Driving, Claims, Drivers: only steps up to the first unfinished one open (call 5) */
export function DetailsTabs({
  states,
  onOpen,
}: {
  states: Record<DetailsTab, TabState>;
  onOpen: (tab: DetailsTab) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const current = (Object.keys(states) as DetailsTab[]).find((tab) => states[tab] === "current");
  // At phone width the tabs scroll sideways: bring the current one into view when it changes. Only
  // the strip scrolls, never the page, and a re-render with the same current tab does nothing.
  useEffect(() => {
    const strip = list.current?.parentElement;
    const item = list.current?.querySelector<HTMLElement>("[aria-current]");
    if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft += item.getBoundingClientRect().left - strip.getBoundingClientRect().left;
  }, [current]);

  return (
    <nav aria-label="Your details" className="quote-tabs">
      <ol ref={list}>
        {(Object.keys(tabLabels) as DetailsTab[]).map((tab, i) => {
          const state = states[tab];
          const label = tabLabels[tab];
          return (
            <li
              key={tab}
              className={`quote-tabs__item quote-tabs__item--${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" || state === "open" ? (
                <button
                  type="button"
                  className="quote-tabs__tab"
                  aria-label={state === "done" ? `${label}, done` : undefined}
                  onClick={() => onOpen(tab)}
                >
                  {state === "done" ? (
                    <Icon name="check" size={16} />
                  ) : (
                    <span className="quote-tabs__number" aria-hidden="true">
                      {i + 1}
                    </span>
                  )}
                  {label}
                </button>
              ) : (
                <span className="quote-tabs__tab">
                  <span className="quote-tabs__number" aria-hidden="true">
                    {i + 1}
                  </span>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** As much of the car as is known: the picker fills it in as the visitor chooses (call 6) */
export interface CarCardCar {
  make: string;
  model?: string;
  variant?: string;
  year?: number;
  fuelType?: string;
  doors?: number;
}

export function CarCard({
  car,
  postcode,
  onChange,
}: {
  car: CarCardCar | null;
  postcode: string;
  onChange?: () => void;
}) {
  const name = car ? [car.make, car.model, car.variant].filter(Boolean).join(" ") : null;
  const details = car
    ? [
        car.year,
        car.fuelType ? fuelLabel(car.fuelType) : undefined,
        car.doors ? `${car.doors} doors` : undefined,
      ].filter(Boolean)
    : [];
  return (
    <section className="quote-car-card" aria-label="Your car">
      {/* At phone width only the name, postcode and Change show, on one line (call 12) */}
      <Icon name="car" size={22} className="quote-car-card__icon" />
      <p className="quote-car-card__overline">Your car</p>
      {name ? <p className="quote-car-card__name">{name}</p> : null}
      {details.length ? <p className="quote-car-card__details">{details.join(" · ")}</p> : null}
      <p className="quote-car-card__postcode">Postcode {postcode}</p>
      {onChange ? (
        <button type="button" className="quote-link" onClick={onChange}>
          Change car or postcode
        </button>
      ) : null}
    </section>
  );
}

export function HelpCard({
  title = "A little help along the way",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Card padding="md" className="quote-help-card">
      <Icon name="message-circle" size={22} />
      <h2 className="kb-h4">{title}</h2>
      <p>{children}</p>
      <a href={helpHref} className="quote-link">
        Contact us
      </a>
    </Card>
  );
}

/** Back on the left (a link-style button with an arrow), the step's own next button on the right */
export function StepNav({
  onBack,
  backLabel = "Back",
  next,
}: {
  onBack?: () => void;
  backLabel?: string;
  next?: ReactNode;
}) {
  return (
    <div className="quote-nav">
      {onBack ? (
        <button type="button" className={cx("quote-link", "quote-back-link")} onClick={onBack}>
          <Icon name="arrow-left" size={18} />
          {backLabel}
        </button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
}
