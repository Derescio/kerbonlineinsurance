import type { PolicyListItem } from "#/server/data/policies";

// The Overview's sums and labels (6.1, decisions 3–5; Figma 258:3608, 258:3635). Dates are the
// stored YYYY-MM-DD strings, compared with London's today (todayIso), so they never shift by a
// time zone.

/** Cover has run its term: the day after `endsOn` has come */
const hasEnded = (p: PolicyListItem, today: string) => p.endsOn < today;

/** Counted on the Overview: in force or starting later, or lapsed (it restarts on a new card) */
export function isHeld(p: PolicyListItem, today: string): boolean {
  return (p.status === "active" || p.status === "lapsed") && !hasEnded(p, today);
}

/** "You're covered": in force or starting later. A lapsed policy alone isn't cover */
export function isCovered(p: PolicyListItem, today: string): boolean {
  return p.status === "active" && !hasEnded(p, today);
}

export interface OverviewStats {
  held: number;
  yearPence: number;
  /** The bundles' savings, for a bundle whose policies are all held */
  bundleSavingPence: number;
}

/**
 * The stat cards. Each premium is already after its share of a bundle's saving (5.7b), so the
 * year is a plain sum; the saving is named only while the whole bundle is still held.
 */
export function overviewStats(policies: PolicyListItem[], today: string): OverviewStats {
  const held = policies.filter((p) => isHeld(p, today));
  const savings = new Map<string, number>();
  for (const p of policies) {
    if (!p.bundle) continue;
    const whole = isHeld(p, today) && savings.get(p.bundle.id) !== 0;
    savings.set(p.bundle.id, whole ? p.bundle.savingPence : 0);
  }
  return {
    held: held.length,
    yearPence: held.reduce((total, p) => total + p.annualPremiumPence, 0),
    bundleSavingPence: [...savings.values()].reduce((total, saving) => total + saving, 0),
  };
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "1 Dec" */
export const shortDay = (iso: string) => SHORT.format(utc(iso));
/** "14 Mar 2027" */
const longDay = (iso: string) => LONG.format(utc(iso));

/** The day after `iso`: a policy renews the day after its cover ends */
function dayAfter(iso: string): string {
  const next = utc(iso);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export interface RowStatus {
  tone: "success" | "warning" | "neutral";
  label: string;
  date: string | null;
}

export function rowStatus(p: PolicyListItem, today: string): RowStatus {
  if (p.status === "cancelled") return { tone: "neutral", label: "Cancelled", date: null };
  if (hasEnded(p, today)) {
    return { tone: "neutral", label: "Ended", date: `Ended ${longDay(p.endsOn)}` };
  }
  if (p.status === "lapsed") return { tone: "warning", label: "Lapsed", date: null };
  const renews = `Renews ${longDay(dayAfter(p.endsOn))}`;
  if (p.startsOn > today) {
    return { tone: "success", label: `Starts ${shortDay(p.startsOn)}`, date: renews };
  }
  return { tone: "success", label: "Active", date: renews };
}

const GREETING_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

/** "Wednesday 18 November", in London */
export function greetingLine(now: Date): string {
  return GREETING_DAY.format(now).replace(",", "");
}

export interface PolicyGroup {
  bundle: PolicyListItem["bundle"];
  policies: PolicyListItem[];
}

/** Bundled policies together where the first of them falls in the list, car first (5.7b) */
export function groupByBundle(policies: PolicyListItem[]): PolicyGroup[] {
  const groups: PolicyGroup[] = [];
  const byBundle = new Map<string, PolicyListItem[]>();
  for (const policy of policies) {
    if (!policy.bundle) {
      groups.push({ bundle: null, policies: [policy] });
      continue;
    }
    const members = byBundle.get(policy.bundle.id);
    if (members) {
      members.push(policy);
      continue;
    }
    const group = { bundle: policy.bundle, policies: [policy] };
    byBundle.set(policy.bundle.id, group.policies);
    groups.push(group);
  }
  for (const group of groups) {
    group.policies.sort((a, b) => (a.product === b.product ? 0 : a.product === "car" ? -1 : 1));
  }
  return groups;
}
