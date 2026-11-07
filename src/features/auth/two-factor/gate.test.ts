import { describe, expect, it } from "vite-plus/test";

import { challengeGate } from "./gate";

// Where /login/two-factor's beforeLoad sends each visitor (Review Focus 2). In sign-in mode (email
// and password, call 8) there's no session yet, only the two_factor cookie, so the state is guest.

describe("challengeGate", () => {
  it("keeps a guest who has just given their email and password (via=email)", () => {
    expect(challengeGate("guest", { via: "email", redirect: "/staff" })).toBeNull();
  });

  it("sends any other guest to log in, keeping the redirect", () => {
    expect(challengeGate("guest", { redirect: "/staff" })).toBe("/login?redirect=%2Fstaff");
    expect(challengeGate("guest", {})).toBe("/login");
  });

  it("drops an off-site redirect on the way to log in (Review Focus 4)", () => {
    expect(challengeGate("guest", { redirect: "//evil.example" })).toBe("/login");
  });

  it("keeps a session that owes a code, whatever `via` says", () => {
    expect(challengeGate("needs_code", {})).toBeNull();
    expect(challengeGate("needs_code", { via: "email" })).toBeNull();
  });

  it("sends a session with nothing owing on to its redirect, same-site only", () => {
    expect(challengeGate("signed_in", { redirect: "/staff" })).toBe("/staff");
    expect(challengeGate("signed_in", { redirect: "//evil.example" })).toBe("/account");
    expect(challengeGate("signed_in", { via: "email" })).toBe("/account");
  });
});
