import { queryOptions } from "@tanstack/react-query";

import type { Occupation } from "./occupation";

// The active car version's occupations (5.3, call 11). It only changes in a deploy, so one fetch
// per tab is enough, with one retry, as the catalogue (5.2, call 14).

export interface OccupationsData {
  occupations: Occupation[];
}

async function fetchOccupations(): Promise<OccupationsData> {
  const response = await fetch("/api/occupations");
  if (!response.ok) throw new Error(`occupations: ${response.status}`);
  return (await response.json()) as OccupationsData;
}

export const occupationsQuery = queryOptions({
  queryKey: ["occupations"],
  queryFn: fetchOccupations,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 1,
});
