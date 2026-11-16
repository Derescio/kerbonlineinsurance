import { useEffect, useRef, useState } from "react";

import { BuyStep } from "./BuyGate";
import { ChooseCover } from "./ChooseCover";
import { ContentsStep } from "./ContentsStep";
import { HomeAboutStep } from "./HomeAboutStep";
import { HomeClaimsStep } from "./HomeClaimsStep";
import { HomeQuote } from "./HomeQuote";
import {
  firstIncompleteHomeStep,
  HOME_STEPS,
  homeStepState,
  homeTabStates,
  storedHomeAnswers,
  type HomeStep,
} from "./home-steps";
import {
  beginJourney,
  readJourney,
  setCover,
  type CoverChoice,
  type Journey,
} from "./journey-store";
import { DetailsTabs, HelpCard, HomeCard } from "./page-kit";
import { PropertyStep } from "./PropertyStep";
import { todayIso } from "./schemas/dates";
import type { HomeQuoteStep } from "./search";

// The home journey's steps (5.7, decision 2), as DriverSteps runs car's: About you → Property →
// Contents → Claims → Your quote, then Choose cover and the gate (Choose cover's Continue goes
// straight to the gate; 5.7b adds the bundle). The answers live in sessionStorage, so the
// "can't skip ahead" check runs here; a blocked link is replaced, not added to history.

const tabLabels: Record<HomeStep, string> = {
  about: "About you",
  property: "Property",
  contents: "Contents",
  claims: "Claims",
};

const helpLines: Record<HomeStep, string> = {
  about: "Have your property’s details to hand, like when it was built and its rebuild cost.",
  property: "Have your property’s details to hand, like when it was built and its rebuild cost.",
  contents: "Count everything you’d take with you if you moved, at the price of buying it new.",
  claims: "Include claims for buildings or contents, made by anyone who lives with you.",
};

const previous: Record<HomeStep, HomeQuoteStep | undefined> = {
  about: undefined,
  property: "about",
  contents: "property",
  claims: "contents",
};

type Move = (
  step: HomeQuoteStep | undefined,
  opts?: { replace?: boolean; after?: "retrieve" },
) => void;

/** Where a blocked link goes: the first unfinished step */
function reachable(journey: Journey | null, step: HomeQuoteStep, today: string) {
  const first = firstIncompleteHomeStep(journey, today);
  if (first === null) return { ok: true as const };
  const detail = HOME_STEPS.find((s) => s === step);
  const ok = detail !== undefined && HOME_STEPS.indexOf(detail) <= HOME_STEPS.indexOf(first);
  return ok ? { ok: true as const } : { ok: false as const, to: first };
}

export function HomeSteps({
  step,
  postcode,
  after,
  onStep,
  onRestart,
  onPostcode,
}: {
  step: HomeQuoteStep;
  /** The link's postcode, for a visit with no journey in the tab yet */
  postcode: string;
  /** The gate's `after` from the URL (5.6) */
  after?: "retrieve";
  onStep: Move;
  /** The start page, for the gate with no journey in the tab (a paid quote clears it) */
  onRestart?: () => void;
  /** The URL follows a postcode changed on Property (decision 4) */
  onPostcode: (postcode: string) => void;
}) {
  const [view, setView] = useState<{ step: HomeQuoteStep; journey: Journey; today: string } | null>(
    null,
  );
  // Came from Your quote's Edit: Continue returns there when nothing later broke
  const fromSummary = useRef(false);
  // Steps reopened because an edit broke them show their errors straight away
  const reopened = useRef<HomeStep | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<HomeQuoteStep | null>(null);
  const move = useRef(onStep);
  const restart = useRef(onRestart);
  useEffect(() => {
    move.current = onStep;
    restart.current = onRestart;
  });

  // sessionStorage only exists in the browser, so the step shows after hydration
  useEffect(() => {
    const stored = readJourney("home");
    const today = todayIso();
    if (step === "buy" && !stored && restart.current) {
      restart.current();
      return;
    }
    // Home's first step needs no earlier answers, so a first visit starts the journey here, and a
    // new postcode from the link applies before the step shows (the shell's own beginJourney runs
    // after this child's effect, and finds it done)
    const journey = beginJourney("home", postcode);
    const check = reachable(journey, step, today);
    if (!check.ok) {
      reopened.current = storedHomeAnswers(journey, check.to) !== undefined ? check.to : null;
      move.current(check.to, { replace: true });
      return;
    }
    setView({ step, journey, today });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per step; the postcode only seeds it
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

  function done(from: HomeStep) {
    const saved = readJourney("home")!;
    const state = homeStepState(saved, today);
    const later = HOME_STEPS.slice(HOME_STEPS.indexOf(from) + 1);
    const broken = later.find((s) => !state[s]);
    const next: HomeQuoteStep = fromSummary.current
      ? (broken ?? "quote")
      : (broken ?? HOME_STEPS[HOME_STEPS.indexOf(from) + 1] ?? "quote");
    reopened.current =
      next === broken && storedHomeAnswers(saved, broken) !== undefined ? broken : null;
    if (next === "quote") fromSummary.current = false;
    onStep(next);
  }

  function saveCover(cover: CoverChoice) {
    setCover("home", cover);
    const saved = readJourney("home");
    if (saved) setView((v) => (v ? { ...v, journey: saved } : v));
  }

  /** Where the server sends a step that no longer passes: replaced, not pushed */
  function invalid(s: string) {
    const target = (s === "cover" ? "cover" : (HOME_STEPS.find((h) => h === s) ?? "about")) as
      | HomeStep
      | "cover";
    if (target !== "cover") {
      fromSummary.current = true;
      reopened.current = target;
    }
    onStep(target, { replace: true });
  }

  const saveAndExit = () => onStep("buy", { after: "retrieve" });

  const property = journey.property;
  const homeCard = (
    <HomeCard
      home={
        property
          ? {
              line1: property.address?.line1,
              town: property.address?.town,
              propertyType: property.propertyType,
              bedrooms: property.bedrooms,
            }
          : null
      }
      postcode={journey.postcode}
      onChange={step === "property" ? undefined : () => onStep("property")}
    />
  );

  const props = (s: HomeStep) => ({
    journey,
    today,
    revalidate: reopened.current === s,
    onBack: () => onStep(previous[s]),
    onDone: () => done(s),
    tabs: (
      <DetailsTabs<HomeStep>
        labels={tabLabels}
        states={homeTabStates(journey, s, today)}
        onOpen={(tab) => onStep(tab)}
      />
    ),
    aside: (
      <>
        {homeCard}
        <HelpCard>{helpLines[s]}</HelpCard>
      </>
    ),
  });

  const coverAside = (
    <>
      {homeCard}
      <HelpCard title="Need a hand?">
        Compare what each level includes, and check the excess you&rsquo;d pay if you claimed.
      </HelpCard>
    </>
  );

  return (
    <div ref={root} className="quote-step">
      {step === "about" ? <HomeAboutStep {...props("about")} /> : null}
      {step === "property" ? (
        <PropertyStep
          {...props("property")}
          onPostcode={(postcode) => {
            onPostcode(postcode);
            const saved = readJourney("home");
            if (saved) setView((v) => (v ? { ...v, journey: saved } : v));
          }}
        />
      ) : null}
      {step === "contents" ? <ContentsStep {...props("contents")} /> : null}
      {step === "claims" ? <HomeClaimsStep {...props("claims")} /> : null}
      {step === "quote" ? (
        <HomeQuote
          journey={journey}
          homeCard={homeCard}
          onBack={() => onStep("claims")}
          onEdit={(s) => {
            fromSummary.current = true;
            onStep(s);
          }}
          onInvalid={invalid}
          onChooseCover={() => onStep("cover")}
          onCover={saveCover}
          onSaveAndExit={saveAndExit}
        />
      ) : null}
      {step === "cover" ? (
        <ChooseCover
          product="home"
          journey={journey}
          aside={coverAside}
          onBack={() => onStep("quote")}
          onContinue={() => onStep("buy")}
          onSaveAndExit={saveAndExit}
          onCover={saveCover}
          onNotQuoted={() => onStep("quote", { replace: true })}
          onInvalid={invalid}
        />
      ) : null}
      {step === "buy" ? (
        <BuyStep
          product="home"
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
