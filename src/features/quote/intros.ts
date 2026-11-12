import type { VehicleChoice } from "./journey-store";

// The driver steps' intros (5.4b; Revamp R03, R04, R07). A clause about a part not yet answered
// is dropped rather than shown blank (call 13).

type Car = Pick<VehicleChoice, "make" | "model" | "year">;
type Name = { firstName: string; lastName: string };

export function aboutIntro(car: Car | undefined): string {
  return car
    ? `We’ll use this information to build your quote for the ${car.year} ${car.make} ${car.model}.`
    : "We’ll use this information to build your quote.";
}

export function licenceIntro(driver: Name | undefined, car: Car | undefined): string {
  const how = `how the ${car ? `${car.make} ${car.model}` : "car"} is used`;
  return driver
    ? `A few more details about ${driver.firstName} ${driver.lastName} and ${how}.`
    : `A few more details about ${how}.`;
}

export function namedIntro(car: Car | undefined): string {
  return `Add anyone else who needs to drive ${car ? `the ${car.make} ${car.model}` : "your car"}. You’ll remain the main driver.`;
}
