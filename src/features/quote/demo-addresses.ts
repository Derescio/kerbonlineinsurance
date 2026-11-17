import { normalisePostcode } from "./postcode";

// The Property step's address list (5.7, decision 4). postcodes.io has no street addresses and
// Kerb is a demo, so each postcode gets a made-up list: one or two streets picked from the postcode,
// the same every time, in the postcode's district. "Enter address manually" is always there too.

export interface DemoAddress {
  id: string;
  line1: string;
  line2?: string;
  town: string;
}

const STREETS = [
  "Albion Road",
  "Victoria Street",
  "Church Lane",
  "Station Road",
  "Park Avenue",
  "Mill Lane",
  "Queens Road",
  "Kingsway",
  "Greenfield Close",
  "Orchard Way",
  "Elm Grove",
  "Highfield Road",
  "Manor Drive",
  "Springfield Road",
  "The Crescent",
  "Windsor Terrace",
  "Beech Avenue",
  "Chapel Street",
  "Meadow View",
  "Rosebery Gardens",
  "Clarence Road",
  "Willow Walk",
  "Northcote Avenue",
  "Cedar Court",
  "Granville Place",
  "Ashley Road",
  "Hawthorn Rise",
  "Belmont Street",
  "Riverside Walk",
  "St John's Road",
] as const;

/** FNV-1a, as savedQuoteKey uses: stable, not secret */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function demoAddresses(postcode: string, town: string): DemoAddress[] {
  const key = normalisePostcode(postcode) ?? postcode.trim().toUpperCase();
  const h = hash(key);
  const first = STREETS[h % STREETS.length]!;
  const second = STREETS[(h >>> 8) % STREETS.length]!;
  const count = 8 + (h % 5);
  const start = 1 + ((h >>> 16) % 40);

  const list: DemoAddress[] = [];
  for (let i = 0; i < count; i++) {
    // Every fourth entry is a flat in the house before it; the rest of the list moves to the
    // second street halfway down
    const street = i < Math.ceil(count / 2) ? first : second;
    const number = start + i * 2;
    const line1 = i % 4 === 3 ? `Flat 1, ${number - 2} ${street}` : `${number} ${street}`;
    list.push({ id: `${key}-${i}`, line1, town });
  }
  return list;
}
