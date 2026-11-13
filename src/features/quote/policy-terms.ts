import { addYears } from "./schemas/dates";

// Cover dates and the payment schedule (5.6, decisions 6 and 7). Dates are `YYYY-MM-DD` strings
// in London time, worked with UTC arithmetic so a clock change can't move a day.

const MS_PER_DAY = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function toIso(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIso(new Date(Date.UTC(y!, m! - 1, d!) + days * MS_PER_DAY));
}

/** The last day of cover: the day before the start's anniversary (29 February's is 1 March) */
export function policyEndDate(startsOn: string): string {
  const [, m, d] = startsOn.split("-").map(Number);
  const anniversary =
    m === 2 && d === 29 ? addYears(addDays(startsOn, 1), 1) : addYears(startsOn, 1);
  return addDays(anniversary, -1);
}

/** The first `count` monthly due dates, each the start's day clamped to the month's end */
export function instalmentDates(startsOn: string, count: number): string[] {
  const [y, m, d] = startsOn.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const months = m! - 1 + i;
    const year = y! + Math.floor(months / 12);
    const month = months % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d!, lastDay))}`;
  });
}

/** Cover may start today up to 30 days on; the box opens on tomorrow */
export function startDateBounds(today: string): { min: string; max: string; fallback: string } {
  return { min: today, max: addDays(today, 30), fallback: addDays(today, 1) };
}

export interface ScheduleRow {
  instalmentNumber: number;
  amountPence: number;
  dueOn: string;
}

/** One row for annual (the total), twelve for monthly (the monthly payment each) */
export function paymentSchedule(
  plan: "annual" | "monthly",
  totalPence: number,
  monthlyPaymentPence: number,
  startsOn: string,
): ScheduleRow[] {
  if (plan === "annual") return [{ instalmentNumber: 1, amountPence: totalPence, dueOn: startsOn }];
  return instalmentDates(startsOn, 12).map((dueOn, i) => ({
    instalmentNumber: i + 1,
    amountPence: monthlyPaymentPence,
    dueOn,
  }));
}
