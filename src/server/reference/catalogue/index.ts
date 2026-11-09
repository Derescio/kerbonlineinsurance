import { ford } from "./makes/ford";
import { audi, bmw, mercedes, mini, porsche } from "./makes/german";
import { hyundai, kia } from "./makes/korea";
import { nissan } from "./makes/nissan";
import { dacia, landRover, mg, renault, skoda, tesla } from "./makes/others";
import { peugeot } from "./makes/stellantis";
import { toyota } from "./makes/toyota";
import { vauxhall } from "./makes/vauxhall";
import { volkswagen } from "./makes/volkswagen";
import type { MakeSource } from "./types";

// The vehicle catalogue (4.8): about 40 of the cars the UK actually drives (SMMT 2025 best sellers,
// DVLA and SMMT cars on the road) plus performance and prestige cars that show the referral and
// decline rules. Values are worked out from the new price (call 7); groups as published (call 6).
// Kerb is a demo, so a car not listed gets the 5.2 picker's "not in our list" message.
export const CATALOGUE_SOURCES: readonly MakeSource[] = [
  ford,
  vauxhall,
  volkswagen,
  nissan,
  toyota,
  kia,
  hyundai,
  peugeot,
  mg,
  bmw,
  mercedes,
  audi,
  mini,
  skoda,
  renault,
  dacia,
  tesla,
  porsche,
  landRover,
];
