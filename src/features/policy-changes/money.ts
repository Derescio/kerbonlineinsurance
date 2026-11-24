import { formatPounds } from "#/features/rating/money";

// What a policy change costs for the part of the year that's left (6.3b, decision 5). Pro-rata
// by day, no admin fee. `diffPence` is the year's difference with IPT (the car's money after the
// change less before it). Dates are London ISO dates; `endsOn` is the last day of cover.

const DAY_MS = 24 * 60 * 60 * 1000;
// Floating-point slack, so 1320.0000000002 and 1319.9999999998 both come out as 1320
const EPSILON = 1e-9;

/** Whole days from `from` to `to` */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The year's difference for the days of cover left, as a share of the term. `endsOn` is the last
 * day of cover (policyEndDate), so both counts include it, and today too; before cover starts,
 * the whole term is left.
 */
function remaining(diffPence: number, today: string, startsOn: string, endsOn: string): number {
  const from = today > startsOn ? today : startsOn;
  return (diffPence * (daysBetween(from, endsOn) + 1)) / (daysBetween(startsOn, endsOn) + 1);
}

/** Annual plan: a top-up to take now, a refund to make, or nothing */
export function annualSettlement(
  diffPence: number,
  today: string,
  startsOn: string,
  endsOn: string,
): { kind: "charge" | "refund" | "none"; pence: number } {
  const due = Math.round(remaining(diffPence, today, startsOn, endsOn));
  if (due === 0) return { kind: "none", pence: 0 };
  return due > 0 ? { kind: "charge", pence: due } : { kind: "refund", pence: -due };
}

/**
 * Monthly plan: what each remaining instalment changes by. Every one changes by the same amount
 * (the subscription has one price), with the credit charge, rounded toward zero so the pennies
 * are Kerb's. Nothing when no instalment is left.
 */
export function instalmentChange(
  diffPence: number,
  today: string,
  startsOn: string,
  endsOn: string,
  creditRate: number,
  instalmentsLeft: number,
): number {
  if (instalmentsLeft === 0) return 0;
  const each = (remaining(diffPence, today, startsOn, endsOn) * (1 + creditRate)) / instalmentsLeft;
  const rounded = each >= 0 ? Math.floor(each + EPSILON) : Math.ceil(each - EPSILON);
  return rounded === 0 ? 0 : rounded;
}

/** The dialog's price line (decision 14): a monthly change by the month, an annual one as money now */
export function priceLine(
  plan: "annual" | "monthly",
  pence: number,
  direction: "up" | "down" | "same",
): string {
  if (direction === "same") return "Your price stays the same";
  const amount = formatPounds(pence);
  if (plan === "monthly") return `Your price goes ${direction} by ${amount} a month`;
  return direction === "up"
    ? `You'll pay ${amount} now for the rest of the year`
    : `We'll refund ${amount} to your card`;
}

/**
 * The email's price line, sent once the change is made: an annual top-up or refund has happened by
 * then, so it's in the past; a monthly change is the payments still to come, as the dialog said
 */
export function emailPriceLine(
  plan: "annual" | "monthly",
  settlement: "charge" | "refund" | "instalments" | "none",
  amountPence: number,
): string {
  if (settlement === "none" || amountPence === 0) return "Your price stays the same";
  if (plan === "monthly") {
    return priceLine("monthly", Math.abs(amountPence), amountPence > 0 ? "up" : "down");
  }
  return settlement === "charge"
    ? `You paid ${formatPounds(amountPence)} for the rest of the year`
    : `We've refunded ${formatPounds(amountPence)} to your card`;
}
