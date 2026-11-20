import { describe, expect, it } from "vite-plus/test";

import { addProductOffers } from "./add-product";

const today = "2026-11-19";
const rates = { car: 0.08, home: 0.08 };
const row = (product: "car" | "home", status: string, endsOn = "2027-11-18") => ({
  product,
  status,
  endsOn,
});

describe("addProductOffers (6.1b)", () => {
  it("offers the product they don't hold, with the saving only while the other is active", () => {
    expect(addProductOffers([row("car", "active")], today, rates)).toEqual([
      { product: "home", savingRate: 0.08 },
    ]);
    expect(addProductOffers([row("home", "active")], today, rates)).toEqual([
      { product: "car", savingRate: 0.08 },
    ]);
    expect(addProductOffers([row("car", "lapsed")], today, rates)).toEqual([
      { product: "home", savingRate: null },
    ]);
    expect(addProductOffers([row("car", "active", "2026-11-18")], today, rates)).toEqual([]);
    expect(addProductOffers([row("car", "active"), row("home", "active")], today, rates)).toEqual(
      [],
    );
    expect(addProductOffers([], today, rates)).toEqual([]);
    expect(addProductOffers([row("car", "cancelled")], today, rates)).toEqual([]);
  });
});
