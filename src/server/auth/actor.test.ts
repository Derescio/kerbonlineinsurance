import { describe, expect, it } from "vite-plus/test";

import { assertNoConflict, requirePermission, requireUser, type Actor } from "./actor";
import { AuthzError } from "./errors";
import { permissionsFor } from "./permissions";

const customer: Actor = { userId: "u1", customerId: "c1", staff: null };
const handler: Actor = {
  userId: "u2",
  customerId: null,
  staff: {
    displayName: "Sam",
    roles: ["claims_handler"],
    permissions: permissionsFor(["claims_handler"]),
  },
};
const idleStaff: Actor = {
  userId: "u3",
  customerId: null,
  staff: { displayName: "Pat", roles: [], permissions: permissionsFor([]) },
};

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthzError);
    return (error as AuthzError).code;
  }
  return null;
}

describe("requireUser", () => {
  it("throws UNAUTHENTICATED without an actor", () => {
    expect(codeOf(() => requireUser(null))).toBe("UNAUTHENTICATED");
  });
  it("returns the actor", () => {
    expect(requireUser(customer)).toBe(customer);
  });
});

describe("requirePermission", () => {
  it("throws UNAUTHENTICATED without an actor", () => {
    expect(codeOf(() => requirePermission(null, "claims.read_all"))).toBe("UNAUTHENTICATED");
  });
  it("refuses a customer", () => {
    expect(codeOf(() => requirePermission(customer, "claims.read_all"))).toBe("FORBIDDEN");
  });
  it("refuses staff with no roles", () => {
    expect(codeOf(() => requirePermission(idleStaff, "claims.read_all"))).toBe("FORBIDDEN");
  });
  it("lets a handler read all claims", () => {
    expect(requirePermission(handler, "claims.read_all")).toBe(handler);
  });
  it("refuses a handler staff.manage", () => {
    expect(codeOf(() => requirePermission(handler, "staff.manage"))).toBe("FORBIDDEN");
  });
});

describe("assertNoConflict", () => {
  it("throws when the actor owns the record", () => {
    const own: Actor = { ...handler, customerId: "c9" };
    expect(codeOf(() => assertNoConflict(own, "c9"))).toBe("CONFLICT_OF_INTEREST");
  });
  it("passes for someone else's record", () => {
    expect(codeOf(() => assertNoConflict({ ...handler, customerId: "c9" }, "c1"))).toBeNull();
  });
  it("passes when the actor has no customer row", () => {
    expect(codeOf(() => assertNoConflict(handler, "c1"))).toBeNull();
  });
});
