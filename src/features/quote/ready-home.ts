import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { composeCover, TIERS, usableCover } from "./cover";
import { firstIncompleteHomeStep } from "./home-steps";
import { DEFAULT_COVER, readJourney, type Journey } from "./journey-store";
import type { CarOnly } from "./Outcomes";
import { priceQuery } from "./price-query";
import { todayIso } from "./schemas/dates";

// The home quote waiting in the tab, for the car journey's outcome screens (5.7b, decision 5):
// the home journey when every step is done and it prices as quoted, else null. It's only priced
// once complete, so a car journey with no home answers asks the server nothing.

export function useReadyHome(): Journey | null {
  const [home] = useState(() => readJourney("home"));
  const complete = home !== null && firstIncompleteHomeStep(home, todayIso()) === null;
  const { data } = useQuery(
    complete
      ? priceQuery("home", home)
      : { queryKey: ["quote-price", "home", "incomplete"], queryFn: skipToken },
  );
  return complete && data?.status === "quoted" ? home : null;
}

/**
 * The car waiting in a bundle (5.7b, decisions 1 and 5): `off` once its price is in and isn't
 * quoted (or couldn't be had), so home runs alone; else the car alone at its own price for screen
 * 04, null while that price is on its way.
 */
export function useBundleCar(car: Journey | null): { off: boolean; carOnly: CarOnly | null } {
  const query = useQuery(
    car ? priceQuery("car", car) : { queryKey: ["quote-price", "car", "none"], queryFn: skipToken },
  );
  const data = query.data;
  const settled = query.isError || data !== undefined;
  if (!car?.vehicle || data?.status !== "quoted") {
    return { off: car !== null && settled, carOnly: null };
  }
  const chosen = usableCover(data, car.cover ?? DEFAULT_COVER);
  const composed = composeCover(data, chosen.coverLevel, chosen.addons);
  if (!composed) return { off: true, carOnly: null };
  return {
    off: false,
    carOnly: {
      name: `${car.vehicle.make} ${car.vehicle.model} ${car.vehicle.variant}`,
      plate: car.vehicle.demoPlate,
      coverName: TIERS[chosen.coverLevel].name,
      totalPence: composed.totalPence,
    },
  };
}
