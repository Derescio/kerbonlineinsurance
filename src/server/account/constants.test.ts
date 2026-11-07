import { describe, expect, it } from "vite-plus/test";

import { claimStatuses } from "#/server/db/schema/values";

import { CLOSE_LIMIT, CLOSURE_WINDOW_DAYS, OPEN_CLAIM_STATUSES, RETENTION } from "./constants";

describe("closure constants", () => {
  it("holds the numbers", () => {
    expect(CLOSURE_WINDOW_DAYS).toBe(30);
    expect(RETENTION).toEqual({ insuranceRecordsYears: 7, securityEventsMonths: 12 });
    expect(CLOSE_LIMIT).toEqual({ window: 3600, max: 5 });
  });

  it("every open claim status is a real claim status", () => {
    expect([...OPEN_CLAIM_STATUSES]).toEqual(["received", "assessing", "approved"]);
    for (const status of OPEN_CLAIM_STATUSES) expect(claimStatuses).toContain(status);
  });
});
