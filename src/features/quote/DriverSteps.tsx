import { useEffect, useRef, useState } from "react";

import { AboutYouStep } from "./AboutYouStep";
import { AddHome } from "./AddHome";
import { BuyStep } from "./BuyGate";
import { ChooseCover } from "./ChooseCover";
import { ClaimsStep } from "./ClaimsStep";
import {
  readJourney,
  setCover,
  setStepAnswers,
  setVehicle,
  type CoverChoice,
  type Journey,
} from "./journey-store";
import { LicenceStep } from "./LicenceStep";
import { NamedDriversStep } from "./NamedDriversStep";
import { CarCard, DetailsTabs, HelpCard } from "./page-kit";
import { QuoteHolding } from "./QuoteHolding";
import { todayIso } from "./schemas/dates";
import type { QuoteStep } from "./search";
import {
  DRIVER_STEPS,
  firstIncompleteStep,
  stepState,
  storedAnswers,
  tabStates,
  type DriverStep,
} from "./steps";

/** Each step's line in the help card (5.4b, call 7; Revamp R03–R08) */
const helpLines: Record<DriverStep, string> = {
  about: "Keep your vehicle documents and driving licence nearby as you complete your details.",
  driving: "Keep your vehicle documents and driving licence nearby as you complete your details.",
  claims: "Include incidents even if you didn’t claim, and whether or not you were at fault.",
  drivers: "Only people listed on your policy will be covered to drive your car.",
};

// The driver steps in order (5.3, calls 5 and 16): about → driving → claims → drivers → quote, then
// Choose cover, the home offer (5.5) and the gate (5.6), which also need a quoted price: they check
// that themselves.
// The answers live in sessionStorage, so the "can't skip ahead" check runs here in the browser,
// not in the route's beforeLoad (plan P5). A blocked link is replaced, not added to history.

/** `after: "retrieve"` sends the gate on to Your saved quotes rather than pay (5.6) */
type Move = (step: QuoteStep | undefined, opts?: { replace?: boolean; after?: "retrieve" }) => void;

/** Where a blocked link goes: the car step (undefined) or the first unfinished step */
function reachable(journey: Journey | null, step: QuoteStep, today: string) {
  const first = firstIncompleteStep(journey, today);
  if (first === "car") return { ok: false as const, to: undefined };
  if (first === null) return { ok: true as const };
  const driverStep = DRIVER_STEPS.find((s) => s === step);
  const ok =
    driverStep !== undefined && DRIVER_STEPS.indexOf(driverStep) <= DRIVER_STEPS.indexOf(first);
  return ok ? { ok: true as const } : { ok: false as const, to: first };
}

const previous: Record<DriverStep, QuoteStep | undefined> = {
  about: undefined,
  driving: "about",
  claims: "driving",
  drivers: "claims",
};

export function DriverSteps({
  step,
  after,
  onStep,
  onRestart,
}: {
  step: QuoteStep;
  /** The gate's `after` from the URL (5.6) */
  after?: "retrieve";
  onStep: Move;
  /** The start page, for the gate with no journey in the tab (a paid quote clears it, 5.6) */
  onRestart?: () => void;
}) {
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
  const restart = useRef(onRestart);
  useEffect(() => {
    move.current = onStep;
    restart.current = onRestart;
  });

  // sessionStorage only exists in the browser, so the step shows after hydration
  useEffect(() => {
    const journey = readJourney("car");
    const today = todayIso();
    // Never a save of an empty journey: Back to the gate after paying starts again (5.6)
    if (step === "buy" && !journey && restart.current) {
      restart.current();
      return;
    }
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

  /** The cover choice (5.5): saved in the tab, and the view takes the journey with it */
  function saveCover(cover: CoverChoice) {
    setCover(cover);
    const saved = readJourney("car");
    if (saved) setView((v) => (v ? { ...v, journey: saved } : v));
  }

  /** Where the server sends a step that no longer passes: replaced, not pushed */
  function invalid(s: "car" | DriverStep | "cover") {
    if (s !== "car" && s !== "cover") fromSummary.current = true;
    onStep(s === "car" ? undefined : s, { replace: true });
  }

  /** Save and exit, and "Sign in to send this for review": the gate, then Your saved quotes */
  const saveAndExit = () => onStep("buy", { after: "retrieve" });

  /** "Change car or postcode": the car is forgotten, the answers stay (5.4b, call 6) */
  function changeCar() {
    setVehicle(null);
    onStep(undefined);
  }

  const props = (s: DriverStep) => ({
    journey,
    today,
    revalidate: reopened.current === s,
    onBack: () => onStep(previous[s]),
    onDone: () => done(s),
    tabs: (
      <DetailsTabs
        states={tabStates(journey, s, today)}
        onOpen={(tab) => onStep(tab === "car" ? undefined : tab)}
      />
    ),
    aside: (
      <>
        <CarCard car={journey.vehicle ?? null} postcode={journey.postcode} onChange={changeCar} />
        <HelpCard>{helpLines[s]}</HelpCard>
      </>
    ),
  });

  const coverAside = (
    <>
      <CarCard car={journey.vehicle ?? null} postcode={journey.postcode} onChange={changeCar} />
      <HelpCard title="Need a hand?">
        Compare what each level includes, and check the excess you&rsquo;d pay if you claimed.
      </HelpCard>
    </>
  );

  return (
    <div ref={root} className="quote-step">
      {step === "about" ? <AboutYouStep {...props("about")} /> : null}
      {step === "driving" ? <LicenceStep {...props("driving")} /> : null}
      {step === "claims" ? <ClaimsStep {...props("claims")} /> : null}
      {step === "drivers" ? <NamedDriversStep {...props("drivers")} /> : null}
      {step === "quote" ? (
        <QuoteHolding
          journey={journey}
          onBack={() => onStep("drivers")}
          onReviewDrivers={() => {
            fromSummary.current = true;
            onStep("drivers");
          }}
          carCard={
            <CarCard
              car={journey.vehicle ?? null}
              postcode={journey.postcode}
              onChange={changeCar}
            />
          }
          onEdit={(s) => {
            fromSummary.current = true;
            onStep(s);
          }}
          onNamedDrivers={(namedDrivers) => {
            // Removing a driver from the quote view (5.4): saved, then priced again in place
            setStepAnswers("drivers", namedDrivers);
            const saved = readJourney("car");
            if (saved) setView((v) => (v ? { ...v, journey: saved } : v));
          }}
          onChooseCover={() => onStep("cover")}
          onCover={saveCover}
          onSaveAndExit={saveAndExit}
          // Replaced, not pushed: Back would return to the quote, which redirects again
          onInvalid={invalid}
        />
      ) : null}
      {step === "cover" ? (
        <ChooseCover
          journey={journey}
          aside={coverAside}
          onBack={() => onStep("quote")}
          onContinue={() => onStep("add-home")}
          onSaveAndExit={saveAndExit}
          onCover={saveCover}
          onNotQuoted={() => onStep("quote", { replace: true })}
          onInvalid={invalid}
        />
      ) : null}
      {step === "add-home" ? (
        <AddHome
          journey={journey}
          aside={coverAside}
          onBack={() => onStep("cover")}
          onCarOnly={() => onStep("buy")}
          onCover={saveCover}
          onNotQuoted={() => onStep("quote", { replace: true })}
          onInvalid={invalid}
        />
      ) : null}
      {step === "buy" ? (
        <BuyStep
          journey={journey}
          after={after ?? "pay"}
          onBack={() => onStep(after === "retrieve" ? "quote" : "cover")}
          onCover={saveCover}
          onNotQuoted={() => onStep("quote", { replace: true })}
          onInvalid={invalid}
        />
      ) : null}
    </div>
  );
}
