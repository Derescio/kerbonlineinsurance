import type { AuditAction } from "#/server/audit/actions";
import type { AuditValue } from "#/server/audit/chain";
import type { CatalogueRecord } from "#/server/data/reference";
import type {
  accountClosures,
  bundles,
  businesses,
  claimEvents,
  claimMessages,
  claimSettlements,
  claimThirdParties,
  claims,
  customers,
  drivers,
  events,
  notifications,
  payments,
  policies,
  properties,
  quoteItemAddons,
  quoteItemFactors,
  quoteItemOptions,
  quoteItems,
  quotes,
  reviews,
  underwritingDecisions,
  vehicles,
} from "#/server/db/schema";
import type { Product, StaffRole } from "#/server/db/schema/values";
import type { RatingSource } from "#/server/reference/rating/types";

// What generateSeed() takes and returns (4.9). The plan is plain rows, one array per table, in
// the shapes Drizzle inserts. Staff rows, accounts, two-factor rows and the audit chain are made
// by the writer: they depend on the database (staff codes, the chain's last hash) or on secrets.

export interface SeedContext {
  catalogue: readonly CatalogueRecord[];
  versions: Record<Product, { id: string; source: RatingSource }>;
  inbox: { local: string; domain: string };
  /** 2,000 from the script; small in tests */
  crowdSize: number;
}

export type CastRole =
  | "customer-a"
  | "customer-b"
  | "business"
  | "closure-settled"
  | "closure-held"
  | "handler"
  | "admin";

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  cast: CastRole | null;
  /** Closed by 4.7: scrubbed email and name, no way to sign in */
  scrubbed: boolean;
  staff: { displayName: string; roles: StaffRole[] } | null;
}

export interface SeedAuditEntry {
  action: AuditAction;
  entityId: string;
  actorUserId: string | null;
  actorRole: string | null;
  changes?: Record<string, AuditValue>;
}

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export interface SeedPlan {
  users: SeedUser[];
  customers: Row<typeof customers>[];
  quotes: Row<typeof quotes>[];
  quoteItems: Row<typeof quoteItems>[];
  quoteItemOptions: Row<typeof quoteItemOptions>[];
  quoteItemAddons: Row<typeof quoteItemAddons>[];
  quoteItemFactors: Row<typeof quoteItemFactors>[];
  underwritingDecisions: Row<typeof underwritingDecisions>[];
  vehicles: Row<typeof vehicles>[];
  drivers: Row<typeof drivers>[];
  properties: Row<typeof properties>[];
  businesses: Row<typeof businesses>[];
  bundles: Row<typeof bundles>[];
  policies: Row<typeof policies>[];
  payments: Row<typeof payments>[];
  claims: Row<typeof claims>[];
  claimEvents: Row<typeof claimEvents>[];
  claimThirdParties: Row<typeof claimThirdParties>[];
  claimMessages: Row<typeof claimMessages>[];
  claimSettlements: Row<typeof claimSettlements>[];
  reviews: Row<typeof reviews>[];
  notifications: Row<typeof notifications>[];
  events: Row<typeof events>[];
  accountClosures: Row<typeof accountClosures>[];
  /** Chained by the writer, stamped when it runs (call 15) */
  audit: SeedAuditEntry[];
}

export function emptyPlan(): SeedPlan {
  return {
    users: [],
    customers: [],
    quotes: [],
    quoteItems: [],
    quoteItemOptions: [],
    quoteItemAddons: [],
    quoteItemFactors: [],
    underwritingDecisions: [],
    vehicles: [],
    drivers: [],
    properties: [],
    businesses: [],
    bundles: [],
    policies: [],
    payments: [],
    claims: [],
    claimEvents: [],
    claimThirdParties: [],
    claimMessages: [],
    claimSettlements: [],
    reviews: [],
    notifications: [],
    events: [],
    accountClosures: [],
    audit: [],
  };
}
