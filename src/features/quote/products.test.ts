import { describe, expect, it } from "vite-plus/test";

import { buyableProducts, isBuyable, isProductId, productIds, quoteTypes } from "./products";

describe("isProductId", () => {
  it("accepts every listed type", () => {
    for (const id of productIds) expect(isProductId(id), id).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Car", "land", "van", undefined, null, 1]) {
      expect(isProductId(value), String(value)).toBe(false);
    }
  });
});

describe("buyableProducts", () => {
  it("is car and home, both listed types", () => {
    expect(buyableProducts).toEqual(["car", "home"]);
    expect(buyableProducts.every(isProductId)).toBe(true);
  });

  it("isBuyable says which types have a journey", () => {
    expect(productIds.filter(isBuyable)).toEqual(["car", "home"]);
  });
});

describe("quoteTypes", () => {
  it("lists every type once, in the order screen 01 draws them", () => {
    expect(quoteTypes.map((t) => t.id)).toEqual([
      "car",
      "home",
      "landlord",
      "pet",
      "condo",
      "business",
      "tenant",
    ]);
    expect(quoteTypes.map((t) => t.id).sort()).toEqual([...productIds].sort());
    expect(quoteTypes.map((t) => t.label)).toEqual([
      "Car",
      "Home",
      "Landlord",
      "Pet",
      "Condo",
      "Business",
      "Tenant",
    ]);
  });
});
