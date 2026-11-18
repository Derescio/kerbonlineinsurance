// Dates in the quote steps are ISO `YYYY-MM-DD` strings in London time (5.3, call 13). Ages and
// whole years compare calendar parts, never milliseconds, so a clock change or a time zone can't
// move a birthday. A 29 February birthday counts as 28 February in a common year.

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in London, as `YYYY-MM-DD` */
export function todayIso(now: Date = new Date()): string {
  return londonDate.format(now);
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y!, m!, d!];
}

/** The three date boxes as an ISO date, or null for a date that doesn't exist or a short year */
export function isoFromParts(day: string, month: string, year: string): string | null {
  const [d, m, y] = [day, month, year].map((part) => part.trim());
  if (!/^\d{1,2}$/.test(d!) || !/^\d{1,2}$/.test(m!) || !/^\d{4}$/.test(y!)) return null;
  const [dn, mn, yn] = [Number(d), Number(m), Number(y)];
  if (mn < 1 || mn > 12 || dn < 1 || dn > daysIn(yn, mn)) return null;
  return `${pad(yn, 4)}-${pad(mn)}-${pad(dn)}`;
}

/** The same day `years` later (or earlier); 29 February becomes 28 February in a common year */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = parts(iso);
  const year = y + years;
  return `${pad(year, 4)}-${pad(m)}-${pad(Math.min(d, daysIn(year, m)))}`;
}

/** Whole years from `from` to `to`; 0 when `to` is earlier */
export function wholeYearsBetween(from: string, to: string): number {
  if (to < from) return 0;
  let years = parts(to)[0] - parts(from)[0];
  if (addYears(from, years) > to) years -= 1;
  return Math.max(0, years);
}

/** Age in whole years on `today` */
export function ageOn(dateOfBirth: string, today: string): number {
  return wholeYearsBetween(dateOfBirth, today);
}
