import { relations } from "drizzle-orm";

import { accounts, sessions, twoFactors, users } from "./auth";
import { claimEvents, claimMessages, claimSettlements, claimThirdParties, claims } from "./claims";
import { customers } from "./customers";
import { notifications } from "./notifications";
import { bundles, payments, policies } from "./policies";
import { businesses, drivers, properties, vehicles } from "./products";
import { quoteItemAddons, quoteItemFactors, quoteItemOptions, quoteItems, quotes } from "./quotes";
import { reviews } from "./reviews";
import { staffMembers } from "./staff";
import { ratingVersions, underwritingDecisions } from "./underwriting";

// Drizzle relations for the core tables, so 4.5's queries load a policy with its claims (and the
// like) in one query rather than N+1. They describe joins only; the foreign keys are in the tables.

export const usersRelations = relations(users, ({ one, many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  twoFactors: many(twoFactors),
  customer: one(customers),
  staffMember: one(staffMembers),
  notifications: many(notifications),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const twoFactorsRelations = relations(twoFactors, ({ one }) => ({
  user: one(users, { fields: [twoFactors.userId], references: [users.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  user: one(users, { fields: [customers.userId], references: [users.id] }),
  quotes: many(quotes),
  policies: many(policies),
  bundles: many(bundles),
  claims: many(claims),
  payments: many(payments),
  reviews: many(reviews),
}));

export const staffMembersRelations = relations(staffMembers, ({ one, many }) => ({
  user: one(users, { fields: [staffMembers.userId], references: [users.id] }),
  assignedClaims: many(claims),
  decisions: many(underwritingDecisions),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  items: many(quoteItems),
  policies: many(policies),
  payments: many(payments),
  bundle: one(bundles),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one, many }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  ratingVersion: one(ratingVersions, {
    fields: [quoteItems.ratingVersionId],
    references: [ratingVersions.id],
  }),
  selectedOption: one(quoteItemOptions, {
    fields: [quoteItems.selectedOptionId],
    references: [quoteItemOptions.id],
    relationName: "selectedOption",
  }),
  options: many(quoteItemOptions, { relationName: "options" }),
  addons: many(quoteItemAddons),
  factors: many(quoteItemFactors),
  decisions: many(underwritingDecisions),
  vehicle: one(vehicles),
  drivers: many(drivers),
  property: one(properties),
  business: one(businesses),
  policy: one(policies),
}));

export const quoteItemOptionsRelations = relations(quoteItemOptions, ({ one }) => ({
  item: one(quoteItems, {
    fields: [quoteItemOptions.quoteItemId],
    references: [quoteItems.id],
    relationName: "options",
  }),
}));

export const quoteItemAddonsRelations = relations(quoteItemAddons, ({ one }) => ({
  item: one(quoteItems, { fields: [quoteItemAddons.quoteItemId], references: [quoteItems.id] }),
}));

export const quoteItemFactorsRelations = relations(quoteItemFactors, ({ one }) => ({
  item: one(quoteItems, { fields: [quoteItemFactors.quoteItemId], references: [quoteItems.id] }),
}));

export const ratingVersionsRelations = relations(ratingVersions, ({ many }) => ({
  quoteItems: many(quoteItems),
}));

export const underwritingDecisionsRelations = relations(underwritingDecisions, ({ one }) => ({
  item: one(quoteItems, {
    fields: [underwritingDecisions.quoteItemId],
    references: [quoteItems.id],
  }),
  decidedBy: one(staffMembers, {
    fields: [underwritingDecisions.decidedBy],
    references: [staffMembers.userId],
  }),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  item: one(quoteItems, { fields: [vehicles.quoteItemId], references: [quoteItems.id] }),
}));

export const driversRelations = relations(drivers, ({ one }) => ({
  item: one(quoteItems, { fields: [drivers.quoteItemId], references: [quoteItems.id] }),
}));

export const propertiesRelations = relations(properties, ({ one }) => ({
  item: one(quoteItems, { fields: [properties.quoteItemId], references: [quoteItems.id] }),
}));

export const businessesRelations = relations(businesses, ({ one }) => ({
  item: one(quoteItems, { fields: [businesses.quoteItemId], references: [quoteItems.id] }),
}));

export const bundlesRelations = relations(bundles, ({ one, many }) => ({
  customer: one(customers, { fields: [bundles.customerId], references: [customers.id] }),
  quote: one(quotes, { fields: [bundles.quoteId], references: [quotes.id] }),
  policies: many(policies),
}));

export const policiesRelations = relations(policies, ({ one, many }) => ({
  customer: one(customers, { fields: [policies.customerId], references: [customers.id] }),
  quote: one(quotes, { fields: [policies.quoteId], references: [quotes.id] }),
  quoteItem: one(quoteItems, { fields: [policies.quoteItemId], references: [quoteItems.id] }),
  bundle: one(bundles, { fields: [policies.bundleId], references: [bundles.id] }),
  renewalOf: one(policies, {
    fields: [policies.renewalOfPolicyId],
    references: [policies.id],
    relationName: "renewal",
  }),
  renewedBy: many(policies, { relationName: "renewal" }),
  claims: many(claims),
  review: one(reviews),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  customer: one(customers, { fields: [payments.customerId], references: [customers.id] }),
  quote: one(quotes, { fields: [payments.quoteId], references: [quotes.id] }),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  policy: one(policies, { fields: [claims.policyId], references: [policies.id] }),
  customer: one(customers, { fields: [claims.customerId], references: [customers.id] }),
  assignedHandler: one(staffMembers, {
    fields: [claims.assignedHandlerId],
    references: [staffMembers.userId],
  }),
  events: many(claimEvents),
  thirdParties: many(claimThirdParties),
  messages: many(claimMessages),
  settlement: one(claimSettlements),
}));

export const claimEventsRelations = relations(claimEvents, ({ one }) => ({
  claim: one(claims, { fields: [claimEvents.claimId], references: [claims.id] }),
  actor: one(users, { fields: [claimEvents.actorUserId], references: [users.id] }),
}));

export const claimThirdPartiesRelations = relations(claimThirdParties, ({ one }) => ({
  claim: one(claims, { fields: [claimThirdParties.claimId], references: [claims.id] }),
}));

export const claimMessagesRelations = relations(claimMessages, ({ one }) => ({
  claim: one(claims, { fields: [claimMessages.claimId], references: [claims.id] }),
  sender: one(users, { fields: [claimMessages.senderUserId], references: [users.id] }),
}));

export const claimSettlementsRelations = relations(claimSettlements, ({ one }) => ({
  claim: one(claims, { fields: [claimSettlements.claimId], references: [claims.id] }),
  approvedBy: one(staffMembers, {
    fields: [claimSettlements.approvedBy],
    references: [staffMembers.userId],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  policy: one(policies, { fields: [reviews.policyId], references: [policies.id] }),
  customer: one(customers, { fields: [reviews.customerId], references: [customers.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
