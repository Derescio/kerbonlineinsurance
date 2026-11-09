import { describe, expect, it } from "vite-plus/test";

import { isCronAuthorized } from "./cron-auth";

describe("isCronAuthorized", () => {
  const secret = "cron-secret-0123456789";

  it("accepts the Bearer secret only", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isCronAuthorized(null, secret)).toBe(false);
    expect(isCronAuthorized("", secret)).toBe(false);
    expect(isCronAuthorized(secret, secret)).toBe(false);
    expect(isCronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isCronAuthorized("Bearer wrong", secret)).toBe(false);
  });
});
