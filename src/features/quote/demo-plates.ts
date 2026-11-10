import { normalisePlate } from "./plate";

// Kerb is a demo, so the plate lookup is faked (5.2, decision 3): these made-up plates are the only
// ones it knows, and screen 08 lists them (decision 4). Each points at one catalogue row, and a
// test in src/server/reference/catalogue checks the row exists. The age identifier is the car's
// year (21), or the year + 50 for September to February (69 = 2019). The last three letters
// include an I or a Q, which the DVLA never issues there, so no demo plate is a real car's (call 6).

export interface DemoPlate {
  /** As shown, with its space: "VW21 GQL" */
  plate: string;
  make: string;
  model: string;
  year: number;
  variant: string;
}

export const demoPlates: readonly DemoPlate[] = [
  { plate: "VW21 GQL", make: "Volkswagen", model: "Golf", year: 2021, variant: "1.0 TSI Life 5dr" },
  {
    plate: "FD69 KQB",
    make: "Ford",
    model: "Fiesta",
    year: 2019,
    variant: "1.0 EcoBoost 125 Titanium 5dr",
  },
  { plate: "VX22 CQS", make: "Vauxhall", model: "Corsa", year: 2022, variant: "1.2 Turbo SRi 5dr" },
  {
    plate: "TY23 HIQ",
    make: "Toyota",
    model: "Yaris",
    year: 2023,
    variant: "1.5 Hybrid Design CVT 5dr",
  },
  { plate: "TS24 EIV", make: "Tesla", model: "Model 3", year: 2024, variant: "RWD" },
  { plate: "BM20 MIQ", make: "BMW", model: "3 Series", year: 2020, variant: "320d M Sport auto" },
];

/** The demo plate this registration spells, whatever its case and spacing, or null */
export function findDemoPlate(input: string): DemoPlate | null {
  const wanted = normalisePlate(input);
  if (!wanted) return null;
  return demoPlates.find(({ plate }) => normalisePlate(plate) === wanted) ?? null;
}
