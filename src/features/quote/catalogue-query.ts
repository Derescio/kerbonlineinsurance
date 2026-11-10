import { queryOptions } from "@tanstack/react-query";

import type { PickerCar } from "./catalogue";

// The catalogue only changes in a deploy, so one fetch per tab is enough (5.2, call 14). Later
// data types set their own staleTime.

export interface CatalogueData {
  cars: PickerCar[];
}

async function fetchCatalogue(): Promise<CatalogueData> {
  const response = await fetch("/api/catalogue");
  if (!response.ok) throw new Error(`catalogue: ${response.status}`);
  return (await response.json()) as CatalogueData;
}

export const catalogueQuery = queryOptions({
  queryKey: ["catalogue"],
  queryFn: fetchCatalogue,
  staleTime: Infinity,
  gcTime: Infinity,
});
