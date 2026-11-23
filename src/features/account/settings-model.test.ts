import { describe, expect, it } from "vite-plus/test";

import { SECURITY_EVENT_TYPES } from "#/server/db/schema/values";

import { activityLabel, activityWhen, isWarningActivity, mobileSchema } from "./settings-model";

describe("mobileSchema", () => {
  it.each([
    ["07700 900418", "07700 900418"],
    ["07700900418", "07700 900418"],
    ["+44 7700 900418", "07700 900418"],
    ["+447700900418", "07700 900418"],
    ["  ", null],
    ["", null],
  ])("%j → %j", (raw, out) => {
    expect(mobileSchema.parse(raw)).toBe(out);
  });

  it.each(["020 7946 0018", "0770090041", "077009004181", "07700 9OO418", "+33 612345678"])(
    "refuses %s",
    (raw) => {
      expect(mobileSchema.safeParse(raw).error?.issues[0]?.message).toBe(
        "Enter a UK mobile number, like 07700 900418",
      );
    },
  );
});

describe("activityLabel", () => {
  it.each(SECURITY_EVENT_TYPES)("%s has a label", (type) => {
    expect(activityLabel(type, null)).toMatch(/^[A-Z]/);
  });

  it("names Google sign-ins", () => {
    expect(activityLabel("sign_in", "google")).toBe("Signed in with Google");
  });

  it("a password sign-in is plain", () => {
    expect(activityLabel("sign_in", "password")).toBe("Signed in");
  });

  it("uses the spec's wording", () => {
    expect(activityLabel("sign_in_failed", null)).toBe("Failed sign-in attempt");
    expect(activityLabel("two_factor_passed", null)).toBe("Two-factor code accepted");
    expect(activityLabel("sessions_revoked_on_password_change", null)).toBe(
      "Other devices signed out after a password change",
    );
  });
});

it("warns on failures only", () => {
  expect(new Set(SECURITY_EVENT_TYPES.filter(isWarningActivity))).toEqual(
    new Set(["sign_in_failed", "rate_limited", "two_factor_failed", "google_link_refused"]),
  );
});

describe("activityWhen (London)", () => {
  // 15:00 in London (GMT in November)
  const now = new Date("2026-11-22T15:00:00Z");
  it.each([
    ["2026-11-22T14:59:40Z", "Just now"],
    ["2026-11-22T14:59:00Z", "1 minute ago"],
    ["2026-11-22T14:12:00Z", "48 minutes ago"],
    ["2026-11-22T14:00:00Z", "1 hour ago"],
    ["2026-11-22T00:05:00Z", "14 hours ago"],
    ["2026-11-21T21:14:00Z", "Yesterday, 21:14"],
    ["2026-11-12T09:00:00Z", "12 Nov 2026"],
  ])("%s → %s", (at, out) => {
    expect(activityWhen(new Date(at), now)).toBe(out);
  });

  it("uses the London day in summer time", () => {
    // 23:30 UTC on 1 Jul is 00:30 on 2 Jul in London, so it's "today" at noon on 2 Jul
    expect(activityWhen(new Date("2026-07-01T23:30:00Z"), new Date("2026-07-02T11:00:00Z"))).toBe(
      "11 hours ago",
    );
  });

  it("says Yesterday with the London time", () => {
    expect(activityWhen(new Date("2026-07-01T20:14:00Z"), new Date("2026-07-02T11:00:00Z"))).toBe(
      "Yesterday, 21:14",
    );
  });
});
