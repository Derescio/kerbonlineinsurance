import { describe, expect, it } from "vite-plus/test";

import {
  assertNoConflict,
  requireFresh,
  requirePermission,
  requireUser,
  type Actor,
} from "./actor";
import { AuthzError } from "./errors";
import { permissionsFor } from "./permissions";
import { STAFF_FRESH_MS } from "./two-factor-constants";

type Overrides = { enabled?: boolean; verifiedAt?: Date | null };

const actorWith = (
  base: Omit<Actor, "twoFactor">,
  { enabled = false, verifiedAt = null }: Overrides = {},
): Actor => ({ ...base, twoFactor: { enabled, verifiedAt } });

const customerBase = { userId: "u1", customerId: "c1", staff: null };
const handlerBase = {
  userId: "u2",
  customerId: null,
  staff: {
    displayName: "Sam",
    roles: ["claims_handler"],
    permissions: permissionsFor(["claims_handler"]),
  },
};
const customer = actorWith(customerBase);
// A handler with 2FA on and a code already given, the normal state
const handler = actorWith(handlerBase, { enabled: true, verifiedAt: new Date() });
const idleStaff = actorWith(
  {
    userId: "u3",
    customerId: null,
    staff: { displayName: "Pat", roles: [], permissions: permissionsFor([]) },
  },
  { enabled: true, verifiedAt: new Date() },
);

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthzError);
    return (error as AuthzError).code;
  }
  return null;
}

function statusOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as AuthzError).status;
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
  it("refuses a session owing a code", () => {
    const owing = actorWith(customerBase, { enabled: true, verifiedAt: null });
    expect(codeOf(() => requireUser(owing))).toBe("TWO_FACTOR_CHALLENGE");
    expect(statusOf(() => requireUser(owing))).toBe(401);
  });
  it("lets a customer without 2FA through", () => {
    const plain = actorWith(customerBase, { enabled: false });
    expect(requireUser(plain)).toBe(plain);
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
  it("refuses staff without 2FA, even when the permission is held", () => {
    const noTwoFactor = actorWith(handlerBase, { enabled: false });
    expect(codeOf(() => requirePermission(noTwoFactor, "claims.read_all"))).toBe(
      "TWO_FACTOR_REQUIRED",
    );
    expect(statusOf(() => requirePermission(noTwoFactor, "claims.read_all"))).toBe(403);
  });
  it("challenges staff owing a code", () => {
    const owing = actorWith(handlerBase, { enabled: true, verifiedAt: null });
    expect(codeOf(() => requirePermission(owing, "claims.read_all"))).toBe("TWO_FACTOR_CHALLENGE");
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

describe("requireFresh", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const at = (verifiedAt: Date | null) => actorWith(handlerBase, { enabled: true, verifiedAt });

  it("refuses a stamp just past two hours old", () => {
    const stamp = new Date(now.getTime() - STAFF_FRESH_MS - 1);
    expect(codeOf(() => requireFresh(at(stamp), now))).toBe("SESSION_NOT_FRESH");
  });
  it("passes a stamp a second inside two hours", () => {
    const actor = at(new Date(now.getTime() - STAFF_FRESH_MS + 1000));
    expect(requireFresh(actor, now)).toBe(actor);
  });
  it("refuses no stamp", () => {
    expect(codeOf(() => requireFresh(at(null), now))).toBe("SESSION_NOT_FRESH");
  });
});
