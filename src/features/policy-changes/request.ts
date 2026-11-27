import type { AlarmType, CoverLevel, LockType, WindowLockType } from "#/server/db/schema/values";

// What a customer (or Kerbie, 7.5) asks to change on a policy: car changes (6.3b, decisions 11 to
// 13; change car, 6.3c decision 3) and home changes (6.3c, decisions 5 to 7).
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
  | { kind: "cover"; coverLevel: CoverLevel; addons: string[]; voluntaryExcessPence: number }
  | {
      kind: "car_replaced";
      /** The new car's catalogue row: the server reads every car detail from it */
      catalogueVariantId: string;
      /** A demo plate, normalised; null when the car was chosen from the catalogue */
      registration: string | null;
      currentMileage: number;
    }
  | { kind: "home_contents"; contentsValuePence: number; valuablesPence: number }
  | {
      kind: "home_security";
      lockType: LockType;
      windowLocks: WindowLockType;
      alarmType: AlarmType;
      hasSmokeAlarm: boolean;
    };

/** The changes a car policy takes; `cover` is either product's */
export type CarChange = Extract<
  PolicyChangeRequest,
  { kind: "address" | "driver_added" | "driver_removed" | "car_replaced" }
>;
/** The changes a home policy takes; `cover` is either product's */
export type HomeChange = Extract<PolicyChangeRequest, { kind: "home_contents" | "home_security" }>;
