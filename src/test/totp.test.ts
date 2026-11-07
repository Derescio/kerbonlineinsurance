import { describe, expect, it } from "vite-plus/test";

import { totpNow } from "./totp";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("totpNow", () => {
  it("gives six digits, and the same code for a time inside one 30-second step", async () => {
    const at = new Date(1_700_000_010_000);
    const code = await totpNow(SECRET, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(await totpNow(SECRET, new Date(at.getTime() + 5_000))).toBe(code);
  });

  it("gives another code for the previous step", async () => {
    const at = new Date(1_700_000_010_000);
    expect(await totpNow(SECRET, new Date(at.getTime() - 30_000))).not.toBe(
      await totpNow(SECRET, at),
    );
  });

  it("matches the current-clock code when at is now", async () => {
    // Retry once if the 30-second step rolls over between the two calls
    const [a, b] = [await totpNow(SECRET), await totpNow(SECRET, new Date())];
    expect(b === a || b === (await totpNow(SECRET))).toBe(true);
  });

  it("refuses a secret that isn't base32", async () => {
    await expect(totpNow("not base32!")).rejects.toThrow("Not a base32 character");
  });
});
