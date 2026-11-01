import { describe, expect, it } from "vite-plus/test";

import { buyableProducts, isProductId, productIds, quoteHrefFor } from "./products";

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

describe("quoteHrefFor", () => {
  it("links to the quote start with the type set", () => {
    expect(quoteHrefFor("car")).toBe("/quote?type=car");
    expect(quoteHrefFor("landlord")).toBe("/quote?type=landlord");
  });
});

describe("buyableProducts", () => {
  it("is car and home, both listed types", () => {
    expect(buyableProducts).toEqual(["car", "home"]);
    expect(buyableProducts.every(isProductId)).toBe(true);
  });
});
