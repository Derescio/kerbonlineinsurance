import type { ZodType } from "zod";

import { fieldErrors } from "#/lib/validation";

import type { Journey } from "./journey-store";
import {
  aboutYouSchema,
  claimsSchema,
  licenceSchema,
  namedDriversSchema,
} from "./schemas/driver-steps";

// Which driver steps are complete (5.3, call 16). A step counts only if its stored answers still
// pass its schema against today and the other stored parts: an incident can leave the 5-year
// window overnight, and a new date of birth can put the licence before the 17th birthday.

export const DRIVER_STEPS = ["about", "driving", "claims", "drivers"] as const;
export type DriverStep = (typeof DRIVER_STEPS)[number];

/** The answers each step's form starts from and its schema checks */
export function storedAnswers(journey: Journey, step: DriverStep): unknown {
  const main = journey.mainDriver;
  switch (step) {
    case "about": {
      if (!main) return undefined;
      const { licenceType: _t, licenceDate: _d, noClaimsYears: _n, ...about } = main;
      return about;
    }
    case "driving":
      if (!main?.licenceType || !journey.usage) return undefined;
      return {
        licenceType: main.licenceType,
        licenceDate: main.licenceDate,
        noClaimsYears: main.noClaimsYears,
        ...journey.usage,
      };
    case "claims":
      return journey.claims;
    case "drivers":
      return journey.namedDrivers;
  }
}

function schemaFor(journey: Journey, step: DriverStep, today: string): ZodType {
  switch (step) {
    case "about":
      return aboutYouSchema(today);
    case "driving":
      return licenceSchema(today, journey.mainDriver?.dateOfBirth);
    case "claims":
      return claimsSchema(today);
    case "drivers":
      return namedDriversSchema(today);
  }
}

function passes(journey: Journey, step: DriverStep, today: string): boolean {
  const answers = storedAnswers(journey, step);
  return answers !== undefined && schemaFor(journey, step, today).safeParse(answers).success;
}

/** The stored answers' errors, keyed like the form's, for a step reopened after an edit */
export function storedErrors(
  journey: Journey,
  step: DriverStep,
  today: string,
): Record<string, string | undefined> {
  const answers = storedAnswers(journey, step);
  if (answers === undefined) return {};
  const result = fieldErrors(schemaFor(journey, step, today), answers);
  return result.errors ?? {};
}

export function stepState(journey: Journey, today: string): Record<DriverStep, boolean> {
  return {
    about: passes(journey, "about", today),
    driving: passes(journey, "driving", today),
    claims: passes(journey, "claims", today),
    drivers: passes(journey, "drivers", today),
  };
}

/** Where a visitor has to go next: the car step, the first step that fails, or null when done */
export function firstIncompleteStep(
  journey: Journey | null,
  today: string,
): "car" | DriverStep | null {
  if (!journey?.vehicle) return "car";
  const state = stepState(journey, today);
  return DRIVER_STEPS.find((step) => !state[step]) ?? null;
}

/** The details tabs (5.4b, call 5): the car, then the four driver steps */
export type DetailsTab = "car" | DriverStep;
export const DETAILS_TABS: readonly DetailsTab[] = ["car", ...DRIVER_STEPS];

/** done: complete, a link with a tick. open: the first unfinished step, a link. locked: plain text. */
export type TabState = "done" | "open" | "current" | "locked";

/**
 * Each tab's state. Only the steps up to the first unfinished one can be opened, so a tab can never
 * skip past it (5.3, call 5).
 */
export function tabStates(
  journey: Journey | null,
  current: DetailsTab,
  today: string,
): Record<DetailsTab, TabState> {
  const first = firstIncompleteStep(journey, today);
  const firstIndex = first === null ? DETAILS_TABS.length : DETAILS_TABS.indexOf(first);
  const states = {} as Record<DetailsTab, TabState>;
  DETAILS_TABS.forEach((tab, i) => {
    states[tab] =
      tab === current ? "current" : i < firstIndex ? "done" : i === firstIndex ? "open" : "locked";
  });
  return states;
}
