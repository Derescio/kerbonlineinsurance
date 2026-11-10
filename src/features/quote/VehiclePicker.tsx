import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Icon } from "#/components/display/Icon";
import { Select } from "#/components/forms/Select";

import { CarNotListed } from "./CarNotListed";
import { fuelLabel, makesOf, modelsOf, variantsOf, yearsOf, type PickerCar } from "./catalogue";

// Screen 09 (Figma 226:639): make → model → year → variant (5.2, call 10). After a demo plate, the
// four fill one after another so the viewer sees it happen (call 8).

const FILL_STEP_MS = 200;

interface Choice {
  make: string;
  model: string;
  year: string;
  variantId: string;
}

const empty: Choice = { make: "", model: "", year: "", variantId: "" };

function choiceOf(car: PickerCar): Choice {
  return { make: car.make, model: car.model, year: String(car.year), variantId: car.id };
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function VehiclePicker({
  cars,
  fillFrom,
  initial,
  fromPlate,
  loadError,
  onConfirm,
  onBack,
}: {
  /** Undefined while the catalogue loads */
  cars: readonly PickerCar[] | undefined;
  /** A demo plate's car, filled step by step */
  fillFrom?: PickerCar | null;
  /** A car to start with chosen ("Change", plan P5) */
  initial?: PickerCar | null;
  fromPlate: boolean;
  loadError: ReactNode;
  onConfirm: (car: PickerCar) => void;
  onBack: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(() => (initial ? choiceOf(initial) : empty));
  const [notListed, setNotListed] = useState(false);
  const timers = useRef<number[]>([]);

  function stopFill() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }

  useEffect(() => {
    if (!fillFrom) return;
    const full = choiceOf(fillFrom);
    if (reducedMotion()) {
      setChoice(full);
      return;
    }
    const steps: Choice[] = [
      { ...empty, make: full.make },
      { ...empty, make: full.make, model: full.model },
      { ...full, variantId: "" },
      full,
    ];
    setChoice(empty);
    timers.current = steps.map((step, i) =>
      window.setTimeout(() => setChoice(step), FILL_STEP_MS * (i + 1)),
    );
    return stopFill;
  }, [fillFrom]);

  const list = cars ?? [];
  const makes = makesOf(list);
  const models = choice.make ? modelsOf(list, choice.make) : [];
  const years = choice.model ? yearsOf(list, choice.make, choice.model) : [];
  const variants = choice.year
    ? variantsOf(list, choice.make, choice.model, Number(choice.year))
    : [];
  const chosen = variants.find((v) => v.id === choice.variantId) ?? null;

  /** A manual change stops a running fill and clears every later choice */
  function pick(next: Partial<Choice>, clears: (keyof Choice)[]) {
    stopFill();
    setChoice((current) => {
      const updated = { ...current, ...next };
      for (const key of clears) updated[key] = "";
      return updated;
    });
  }

  const disabled = !cars;
  return (
    <>
      <header className="quote-heading">
        <p className="quote-heading__overline">
          {fromPlate ? "Car · Your details" : "Car · Manual lookup"}
        </p>
        <h1 className="kb-h1 quote-heading__title">Choose your car</h1>
        <p className="quote-heading__intro">
          Choose each detail in order. You&rsquo;ll find the exact variant on your vehicle
          documents.
        </p>
      </header>

      <div className="quote-panel quote-picker">
        {loadError}
        <Select
          label="1 · Make"
          hint="Choose the manufacturer."
          placeholder="Choose a make"
          options={makes}
          value={choice.make}
          disabled={disabled}
          onChange={(e) => pick({ make: e.target.value }, ["model", "year", "variantId"])}
        />
        <Select
          label="2 · Model"
          hint="Models depend on the make you choose."
          placeholder="Choose a model"
          options={models}
          value={choice.model}
          disabled={disabled || !choice.make}
          onChange={(e) => pick({ model: e.target.value }, ["year", "variantId"])}
        />
        <div className="quote-picker__pair">
          <Select
            label="3 · Year first registered"
            placeholder="Choose a year"
            options={years.map(String)}
            value={choice.year}
            disabled={disabled || !choice.model}
            onChange={(e) => pick({ year: e.target.value }, ["variantId"])}
          />
          <Select
            label="4 · Variant"
            placeholder="Choose a variant"
            options={variants.map((v) => ({ value: v.id, label: v.variant }))}
            value={choice.variantId}
            disabled={disabled || !choice.year}
            onChange={(e) => pick({ variantId: e.target.value }, [])}
          />
        </div>
        <p className="quote-picker__note">
          Changing an earlier answer clears the choices that depend on it.
        </p>
      </div>

      {chosen ? (
        <section className="quote-aside quote-car" aria-label="Your car">
          <Icon name="car" size={24} />
          <p className="quote-car__name">
            {chosen.make} {chosen.model} {chosen.variant}
          </p>
          <p>
            {chosen.year} · {fuelLabel(chosen.fuelType)} · {chosen.doors} doors
          </p>
        </section>
      ) : null}

      <button type="button" className="quote-link" onClick={() => setNotListed(true)}>
        My car isn&rsquo;t listed
      </button>
      {notListed ? <CarNotListed /> : null}

      <div className="quote-nav">
        <button type="button" className="quote-link" onClick={onBack}>
          Back
        </button>
        <Button variant="accent" disabled={!chosen} onClick={() => chosen && onConfirm(chosen)}>
          Confirm this car
        </Button>
      </div>
    </>
  );
}
