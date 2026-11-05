import { describe, expect, it } from "vite-plus/test";

import { staffRoles } from "#/server/db/schema/values";

import { PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } from "./permissions";

describe("ROLE_PERMISSIONS", () => {
  it("pins who can do what", () => {
    expect(ROLE_PERMISSIONS).toMatchInlineSnapshot(`
      {
        "admin": [
          "claims.read_all",
          "claims.update",
          "referrals.read",
          "referrals.decide",
          "reviews.moderate",
          "staff.manage",
          "audit.read",
        ],
        "claims_handler": [
          "claims.read_all",
          "claims.update",
          "referrals.read",
          "referrals.decide",
        ],
      }
    `);
  });

  it("grants every permission to some role", () => {
    for (const p of PERMISSIONS) expect(Object.values(ROLE_PERMISSIONS).flat()).toContain(p);
  });

  it("has an entry for every role", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...staffRoles].sort());
  });
});

describe("permissionsFor", () => {
  it("unions several roles and ignores unknown ones", () => {
    expect(permissionsFor(["claims_handler", "retired_role"])).toEqual(
      new Set(ROLE_PERMISSIONS.claims_handler),
    );
    expect(permissionsFor([])).toEqual(new Set());
  });
});
