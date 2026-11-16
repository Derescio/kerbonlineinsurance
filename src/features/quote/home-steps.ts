import type { ZodType } from "zod";

import { fieldErrors } from "#/lib/validation";

import type { Journey } from "./journey-store";
import {
  contentsSchema,
  homeAboutSchema,
  homeClaimsSchema,
  propertySchema,
} from "./schemas/home-steps";
import type { TabState } from "./steps";

// Which home steps are complete (5.7, decision 2), as steps.ts does for car (5.3, call 16): a step
// counts only if its stored answers still pass against today. Home has no car step, so an empty
// journey starts at About you.

export const HOME_STEPS = ["about", "property", "contents", "claims"] as const;
export type HomeStep = (typeof HOME_STEPS)[number];

/** The answers each step's form starts from and its schema checks */
export function storedHomeAnswers(journey: Journey, step: HomeStep): unknown {
  switch (step) {
    case "about":
      return journey.homeAbout;
    case "property":
      return journey.property;
    case "contents":
      return journey.contents;
    case "claims":
      return journey.homeClaims;
  }
}

function schemaFor(step: HomeStep, today: string): ZodType {
  switch (step) {
    case "about":
      return homeAboutSchema(today);
    case "property":
      return propertySchema(Number(today.slice(0, 4)));
    case "contents":
      return contentsSchema;
    case "claims":
      return homeClaimsSchema(today);
  }
}

function passes(journey: Journey, step: HomeStep, today: string): boolean {
  const answers = storedHomeAnswers(journey, step);
  return answers !== undefined && schemaFor(step, today).safeParse(answers).success;
}

/** The stored answers' errors, keyed like the form's, for a step reopened after an edit */
export function storedHomeErrors(
  journey: Journey,
  step: HomeStep,
  today: string,
): Record<string, string | undefined> {
  const answers = storedHomeAnswers(journey, step);
  if (answers === undefined) return {};
  return fieldErrors(schemaFor(step, today), answers).errors ?? {};
}

export function homeStepState(journey: Journey, today: string): Record<HomeStep, boolean> {
  return {
    about: passes(journey, "about", today),
    property: passes(journey, "property", today),
    contents: passes(journey, "contents", today),
    claims: passes(journey, "claims", today),
  };
}

/** Where a visitor has to go next: the first step that fails, or null when done */
export function firstIncompleteHomeStep(journey: Journey | null, today: string): HomeStep | null {
  if (!journey) return "about";
  const state = homeStepState(journey, today);
  return HOME_STEPS.find((step) => !state[step]) ?? null;
}

/** Each tab's state; only the steps up to the first unfinished one can be opened (5.3, call 5) */
export function homeTabStates(
  journey: Journey | null,
  current: HomeStep,
  today: string,
): Record<HomeStep, TabState> {
  const first = firstIncompleteHomeStep(journey, today);
  const firstIndex = first === null ? HOME_STEPS.length : HOME_STEPS.indexOf(first);
  const states = {} as Record<HomeStep, TabState>;
  HOME_STEPS.forEach((tab, i) => {
    states[tab] =
      tab === current ? "current" : i < firstIndex ? "done" : i === firstIndex ? "open" : "locked";
  });
  return states;
}
