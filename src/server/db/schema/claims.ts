import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { createdAt, id, lastFour, oneOf, pence, updatedAt } from "./columns";
import { policies } from "./policies";
import { staffMembers } from "./staff";
import {
  claimEventTypes,
  claimEventVisibilities,
  claimStatuses,
  incidentTypes,
  messageSenderKinds,
  settlementStatuses,
} from "./values";

// A claim is kept consistent with its policy's customer by a composite foreign key (4.2, decision
// 7): scoped queries filter by customer_id in one indexed lookup, and a claim can never point at
// someone else's policy. The incident fields stay empty while `draft` ("Save and exit").
export const claims = pgTable(
  "claims",
  {
    id: id(),
    reference: text().notNull().unique(),
    policyId: uuid().notNull(),
    customerId: uuid().notNull(),
    status: text().notNull().default("draft"),
    incidentType: text().notNull(),
    incidentAt: timestamp({ withTimezone: true }),
    incidentLocation: text(),
    description: text(),
    declarationAcceptedAt: timestamp({ withTimezone: true }),
    submittedAt: timestamp({ withTimezone: true }),
    otherVehicleInvolved: boolean().notNull().default(false),
    rearEnded: boolean().notNull().default(false),
    injuries: boolean().notNull().default(false),
    policeAttended: boolean().notNull().default(false),
    policeReference: text(),
    claimedAmountPence: integer(),
    assignedHandlerId: text().references(() => staffMembers.userId),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("claims_reference_check", sql`${t.reference} ~ '^KRB-C-[0-9]{5}$'`),
    check("claims_status_check", oneOf(t.status, claimStatuses)),
    check("claims_incident_type_check", oneOf(t.incidentType, incidentTypes)),
    check("claims_description_check", sql`char_length(${t.description}) <= 2000`),
    check(
      "claims_submitted_check",
      sql`${t.status} = 'draft' or (${t.incidentAt} is not null and ${t.incidentLocation} is not null and ${t.description} is not null and ${t.declarationAcceptedAt} is not null and ${t.submittedAt} is not null)`,
    ),
    check(
      "claims_police_reference_check",
      sql`${t.policeReference} is null or ${t.policeAttended}`,
    ),
    check("claims_claimed_amount_check", sql`${t.claimedAmountPence} >= 0`),
    check("claims_version_check", sql`${t.version} >= 1`),
    foreignKey({
      name: "claims_policy_fk",
      columns: [t.policyId, t.customerId],
      foreignColumns: [policies.id, policies.customerId],
    }).onDelete("restrict"),
    index().on(t.policyId),
    index().on(t.customerId),
    index().on(t.assignedHandlerId),
    index().on(t.status),
    index().on(t.createdAt),
    index().on(t.updatedAt),
  ],
);

// The claim's timeline. Append-only: the 0002 trigger refuses UPDATE (decision 8), except the
// `SET NULL` on actor_user_id when that user's account is deleted.
export const claimEvents = pgTable(
  "claim_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    claimId: uuid()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    type: text().notNull(),
    // The tracker shows only `customer` rows; staff notes are `internal`
    visibility: text().notNull(),
    fromStatus: text(),
    toStatus: text(),
    note: text(),
    actorUserId: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("claim_events_type_check", oneOf(t.type, claimEventTypes)),
    check("claim_events_visibility_check", oneOf(t.visibility, claimEventVisibilities)),
    check("claim_events_from_status_check", oneOf(t.fromStatus, claimStatuses)),
    check("claim_events_to_status_check", oneOf(t.toStatus, claimStatuses)),
    index().on(t.claimId),
    index().on(t.actorUserId),
    index().on(t.createdAt),
  ],
);

// Personal data about someone who isn't our customer: the data contract drops it
export const claimThirdParties = pgTable(
  "claim_third_parties",
  {
    id: id(),
    claimId: uuid()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    name: text(),
    registration: text(),
    insurerName: text(),
    policyNumber: text(),
    phone: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "claim_third_parties_any_check",
      sql`num_nonnulls(${t.name}, ${t.registration}, ${t.insurerName}, ${t.policyNumber}, ${t.phone}) > 0`,
    ),
    index().on(t.claimId),
    index().on(t.updatedAt),
  ],
);

// Customer ↔ staff messages on a claim
export const claimMessages = pgTable(
  "claim_messages",
  {
    id: id(),
    claimId: uuid()
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    senderUserId: text().references(() => users.id, { onDelete: "set null" }),
    senderKind: text().notNull(),
    body: text().notNull(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("claim_messages_sender_kind_check", oneOf(t.senderKind, messageSenderKinds)),
    check("claim_messages_body_check", sql`char_length(${t.body}) between 1 and 2000`),
    index().on(t.claimId, t.createdAt),
    index().on(t.senderUserId),
    index().on(t.updatedAt),
  ],
);

// The settlement: approved value − excess = payout (never below zero)
export const claimSettlements = pgTable(
  "claim_settlements",
  {
    id: id(),
    claimId: uuid()
      .notNull()
      .unique("claim_settlements_claim_id_unique")
      .references(() => claims.id, { onDelete: "cascade" }),
    approvedAmountPence: pence(),
    excessPence: pence(),
    payoutPence: pence(),
    payeeName: text().notNull(),
    accountLast4: text().notNull(),
    status: text().notNull().default("scheduled"),
    expectedOn: date().notNull(),
    paidAt: timestamp({ withTimezone: true }),
    approvedBy: text()
      .notNull()
      .references(() => staffMembers.userId),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "claim_settlements_amounts_check",
      sql`${t.approvedAmountPence} >= 0 and ${t.excessPence} >= 0 and ${t.payoutPence} >= 0`,
    ),
    check(
      "claim_settlements_payout_check",
      sql`${t.payoutPence} = greatest(${t.approvedAmountPence} - ${t.excessPence}, 0)`,
    ),
    check("claim_settlements_account_last4_check", lastFour(t.accountLast4)),
    check("claim_settlements_status_check", oneOf(t.status, settlementStatuses)),
    check(
      "claim_settlements_paid_at_check",
      sql`(${t.status} = 'paid') = (${t.paidAt} is not null)`,
    ),
    index().on(t.approvedBy),
    index().on(t.updatedAt),
  ],
);
