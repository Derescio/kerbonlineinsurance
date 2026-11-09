import { describe, expect, it } from "vite-plus/test";

import { AUDIT_ACTIONS, type AuditAction } from "./actions";

describe("AUDIT_ACTIONS", () => {
  it("pins the list", () => {
    expect(AUDIT_ACTIONS).toMatchSnapshot();
  });

  it("has the five account actions, each against a user", () => {
    for (const name of [
      "account.deleted",
      "account.closure_requested",
      "account.closure_cancelled",
      "account.closure_held",
      "account.closed",
    ] as const) {
      expect(AUDIT_ACTIONS[name].entityType).toBe("user");
    }
  });

  it("records a staff member opening a file against the file (4.10)", () => {
    expect(AUDIT_ACTIONS["file.viewed"].entityType).toBe("file");
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
