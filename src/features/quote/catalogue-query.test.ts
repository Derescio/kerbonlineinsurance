import { describe, expect, it } from "vite-plus/test";

import { catalogueQuery } from "./catalogue-query";

describe("catalogueQuery", () => {
  it("never goes stale and retries a failure once, so the error shows within seconds", () => {
    expect(catalogueQuery.staleTime).toBe(Infinity);
    expect(catalogueQuery.retry).toBe(1);
  });
});
