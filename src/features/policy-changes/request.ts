import type { CoverLevel } from "#/server/db/schema/values";

// What a customer (or Kerbie, 7.5) asks to change on a car policy (6.3b, decisions 11 to 13).
// The server checks it with the schema in Task 4; this is its shape.

export type OvernightLocation = "garage" | "driveway" | "street";

export interface NewDriver {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  relationship: string;
  licenceType: string;
  licenceDate: string;
  occupation: string;
  employmentStatus: string;
  /** The frame's "no claims or convictions in the last 5 years": anything else isn't online */
  noClaimsConfirmed: true;
}

export type PolicyChangeRequest =
  | {
      kind: "address";
      postcode: string;
      addressLine1: string;
      addressLine2: string | null;
      town: string;
      overnightLocation: OvernightLocation;
    }
  | { kind: "driver_added"; driver: NewDriver }
  | { kind: "driver_removed"; driverId: string }
  | { kind: "cover"; coverLevel: CoverLevel; addons: string[]; voluntaryExcessPence: number };
