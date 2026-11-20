import { isCovered, isHeld } from "./overview-model";

// Which product the Overview offers to add (6.1b, decision 1). Held matches the Overview:
// active (including one that starts later) or lapsed, and not ended. The saving needs an
// active policy of the other product.

export interface AddOffer {
  product: "car" | "home";
  /** The new product's bundle_discount_rate when an active policy of the other one earns it */
  savingRate: number | null;
}

type Row = { product: string; status: string; endsOn: string };

export function addProductOffers(
  policies: readonly Row[],
  today: string,
  rates: { car: number; home: number },
): AddOffer[] {
  const held = (product: string) =>
    policies.some((policy) => policy.product === product && isHeld(policy, today));
  const earns = (product: string) =>
    policies.some((policy) => policy.product === product && isCovered(policy, today));
  if (!held("car") && !held("home")) return [];
  const offers: AddOffer[] = [];
  if (!held("home")) offers.push({ product: "home", savingRate: earns("car") ? rates.home : null });
  if (!held("car")) offers.push({ product: "car", savingRate: earns("home") ? rates.car : null });
  return offers;
}
