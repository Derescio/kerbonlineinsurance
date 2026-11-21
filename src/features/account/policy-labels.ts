import { relationshipOptions, usageOptions } from "#/features/quote/schemas/driver-steps";
import { formatPounds } from "#/features/rating/money";
import type { PolicyDetail, PolicyDriver } from "#/server/data/policies";

// Words for a policy's details, shared by its page and its documents (6.2), so the two agree.

const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

/** "Social, domestic and commuting" */
export const usageLabel = (usage: string) => labelOf(usageOptions, usage);

const licence = (years: number) => `${years} ${years === 1 ? "year" : "years"} licence`;

/** "Main driver · 9 years licence", or the named driver's relationship to the policyholder */
export function driverLine(driver: PolicyDriver): string {
  const role = driver.isMain
    ? "Main driver"
    : driver.relationship
      ? labelOf(relationshipOptions, driver.relationship)
      : "Named driver";
  return `${role} · ${licence(driver.licenceYears)}`;
}

export const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`;

/** The car ("Volkswagen Golf") or the home ("11 Rosebery Gardens, London"), as the Overview names it */
export function insuredName(policy: Pick<PolicyDetail, "car" | "home" | "reference">): string {
  if (policy.car) return `${policy.car.make} ${policy.car.model}`;
  if (policy.home) return `${policy.home.addressLine1}, ${policy.home.town}`;
  return policy.reference;
}

/** A whole-pound amount drops the pence ("£250"), as the frames do */
export const wholePounds = (pence: number) => formatPounds(pence).replace(/\.00$/, "");

/** "£250", and what it's made of: "£100 compulsory + £150 voluntary" or "£250 compulsory" */
export function excessParts(
  policy: Pick<PolicyDetail, "compulsoryExcessPence" | "voluntaryExcessPence">,
): {
  total: string;
  parts: string;
} {
  const { compulsoryExcessPence: compulsory, voluntaryExcessPence: voluntary } = policy;
  return {
    total: wholePounds(compulsory + voluntary),
    parts: voluntary
      ? `${wholePounds(compulsory)} compulsory + ${wholePounds(voluntary)} voluntary`
      : `${wholePounds(compulsory)} compulsory`,
  };
}
