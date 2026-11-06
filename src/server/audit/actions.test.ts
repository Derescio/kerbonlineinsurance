import { describe, expect, it } from "vite-plus/test";

import { AUDIT_ACTIONS, type AuditAction } from "./actions";

describe("AUDIT_ACTIONS", () => {
  it("pins the list", () => {
    expect(AUDIT_ACTIONS).toMatchSnapshot();
  });

  it("every name is area.verb", () => {
    // The same pattern as audit_log_action_check in 0001
    for (const name of Object.keys(AUDIT_ACTIONS)) {
      expect(name).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
    }
  });

  it("an unknown name is a type error", () => {
    // @ts-expect-error claim.deleted is not an audit action
    const _x: AuditAction = "claim.deleted";
    expect(_x).toBe("claim.deleted");
  });
});
