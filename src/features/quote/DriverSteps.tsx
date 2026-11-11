import { useEffect, useRef, useState } from "react";

import { AboutYouStep } from "./AboutYouStep";
import { ClaimsStep } from "./ClaimsStep";
import { readJourney, type Journey } from "./journey-store";
import { LicenceStep } from "./LicenceStep";
import { NamedDriversStep } from "./NamedDriversStep";
import { QuoteHolding } from "./QuoteHolding";
import { todayIso } from "./schemas/dates";
import type { QuoteStep } from "./search";
import {
  DRIVER_STEPS,
  firstIncompleteStep,
  stepState,
  storedAnswers,
  type DriverStep,
} from "./steps";

// The driver steps in order (5.3, calls 5 and 16): about → driving → claims → drivers → quote.
// The answers live in sessionStorage, so the "can't skip ahead" check runs here in the browser,
// not in the route's beforeLoad (plan P5). A blocked link is replaced, not added to history.

type Move = (step: QuoteStep | undefined, opts?: { replace?: boolean }) => void;

/** Where a blocked link goes: the car step (undefined) or the first unfinished step */
function reachable(journey: Journey | null, step: QuoteStep, today: string) {
  const first = firstIncompleteStep(journey, today);
  if (first === "car") return { ok: false as const, to: undefined };
  if (first === null) return { ok: true as const };
  const ok = step !== "quote" && DRIVER_STEPS.indexOf(step) <= DRIVER_STEPS.indexOf(first);
  return ok ? { ok: true as const } : { ok: false as const, to: first };
}

const previous: Record<DriverStep, QuoteStep | undefined> = {
  about: undefined,
  driving: "about",
  claims: "driving",
  drivers: "claims",
};

export function DriverSteps({ step, onStep }: { step: QuoteStep; onStep: Move }) {
  const [view, setView] = useState<{ step: QuoteStep; journey: Journey; today: string } | null>(
    null,
  );
  // Came from the summary's Edit: Continue returns there when nothing later broke
  const fromSummary = useRef(false);
  // Steps reopened because an edit broke them show their errors straight away
  const reopened = useRef<DriverStep | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<QuoteStep | null>(null);
  // The route passes a new function each render; the effect below runs per step, not per render
  const move = useRef(onStep);
  useEffect(() => {
    move.current = onStep;
  });

  // sessionStorage only exists in the browser, so the step shows after hydration
  useEffect(() => {
    const journey = readJourney("car");
    const today = todayIso();
    const check = reachable(journey, step, today);
    if (!check.ok) {
      // A step that had answers and no longer passes (an incident left the 5-year window
      // overnight) opens with its errors, as after an edit (call 16)
      reopened.current =
        check.to && journey && storedAnswers(journey, check.to) !== undefined ? check.to : null;
      move.current(check.to, { replace: true });
      return;
    }
    setView({ step, journey: journey!, today });
  }, [step]);

  // A move between steps puts focus on the new heading; the page's first step leaves it alone
  useEffect(() => {
    if (!view) return;
    if (shown.current !== null && shown.current !== view.step) {
      root.current?.querySelector<HTMLElement>("h1")?.focus();
    }
    shown.current = view.step;
  }, [view]);

  if (!view || view.step !== step) return null;
  const { journey, today } = view;

  function done(from: DriverStep) {
    const saved = readJourney("car")!;
    const state = stepState(saved, today);
    const later = DRIVER_STEPS.slice(DRIVER_STEPS.indexOf(from) + 1);
    const broken = later.find((s) => !state[s]);
    const next: QuoteStep = fromSummary.current
      ? (broken ?? "quote")
      : (broken ?? DRIVER_STEPS[DRIVER_STEPS.indexOf(from) + 1] ?? "quote");
    // Reopened with its errors only when it had answers an edit broke, not on a first run
    reopened.current =
      next === broken && storedAnswers(saved, broken) !== undefined ? broken : null;
    if (next === "quote") fromSummary.current = false;
    onStep(next);
  }

  const props = (s: DriverStep) => ({
    journey,
    today,
    revalidate: reopened.current === s,
    onBack: () => onStep(previous[s]),
    onDone: () => done(s),
  });

  return (
    <div ref={root} className="quote-step">
      {step === "about" ? <AboutYouStep {...props("about")} /> : null}
      {step === "driving" ? <LicenceStep {...props("driving")} /> : null}
      {step === "claims" ? <ClaimsStep {...props("claims")} /> : null}
      {step === "drivers" ? <NamedDriversStep {...props("drivers")} /> : null}
      {step === "quote" ? (
        <QuoteHolding
          journey={journey}
          onEdit={(s) => {
            fromSummary.current = true;
            onStep(s);
          }}
        />
      ) : null}
    </div>
  );
}
