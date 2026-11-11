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

function passes(journey: Journey, step: DriverStep, today: string): boolean {
  const answers = storedAnswers(journey, step);
  if (answers === undefined) return false;
  switch (step) {
    case "about":
      return aboutYouSchema(today).safeParse(answers).success;
    case "driving":
      return licenceSchema(today, journey.mainDriver?.dateOfBirth).safeParse(answers).success;
    case "claims":
      return claimsSchema(today).safeParse(answers).success;
    case "drivers":
      return namedDriversSchema(today).safeParse(answers).success;
  }
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
