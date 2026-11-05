import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { dataContract } from "#/server/db/data-contract";
import {
  auditLog,
  bundles,
  claimEvents,
  claimMessages,
  claimSettlements,
  claimThirdParties,
  claims,
  customers,
  deletedRows,
  drivers,
  events,
  notifications,
  policies,
  quoteItemFactors,
  quoteItemOptions,
  quoteItems,
  quotes,
  reviews,
  sessions,
  staffRoles,
  underwritingDecisions,
  users,
  vehicles,
} from "#/server/db/schema";
import { TEST_DATABASE_URL, truncateAll } from "#/test/db";
import {
  makeClaim,
  makeCustomer,
  makePayment,
  makePolicy,
  makeQuote,
  makeRatingVersion,
  makeStaff,
  makeUser,
} from "#/test/factories";

// The integrity rules Postgres enforces (4.2). Each refusal checks the Postgres error code (and,
// where there's one, the constraint's name), so a test can't pass for the wrong reason.
const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const NOT_NULL = "23502";
// A foreign key's ON DELETE RESTRICT
const RESTRICTED = "23001";
// Raised by the 0002 refuse_change() trigger
const APPEND_ONLY = "42501";

async function expectRefused(query: PromiseLike<unknown>, code: string, constraint?: string) {
  const error = await Promise.resolve(query).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error, "Postgres accepted the row").toBeDefined();
  // Drizzle wraps the driver's error; the Postgres fields are on its cause
  const pg = ((error as { cause?: unknown }).cause ?? error) as {
    code?: string;
    constraint?: string;
  };
  expect(pg.code).toBe(code);
  if (constraint) expect(pg.constraint).toBe(constraint);
}

const db = () => getDb();

describe("Postgres integrity rules", () => {
  beforeEach(truncateAll);
  afterAll(closeDb);

  describe("basics", () => {
    it("refuses a review rated 6", async () => {
      const policy = await makePolicy();
      await expectRefused(
        db().insert(reviews).values({
          policyId: policy.id,
          customerId: policy.customerId,
          rating: 6,
          title: "Great",
          body: "Great",
        }),
        CHECK,
        "reviews_rating_check",
      );
    });

    it("refuses a negative premium", async () => {
      await expectRefused(makePolicy({ annualPremiumPence: -1 }), CHECK, "policies_amounts_check");
    });

    it("refuses a second policy for the same quote item", async () => {
      const policy = await makePolicy();
      await expectRefused(
        makePolicy({ customerId: policy.customerId, quoteItemId: policy.quoteItemId }),
        UNIQUE,
        "policies_quote_item_id_unique",
      );
    });

    it("refuses an unknown claim status", async () => {
      await expectRefused(makeClaim({ status: "lost" }), CHECK, "claims_status_check");
    });

    it("refuses a customer with no postcode", async () => {
      const user = await makeUser();
      await expectRefused(
        db().execute(
          sql`insert into customers (user_id, first_name, last_name, date_of_birth, address_line1, town)
              values (${user.id}, 'A', 'B', '1990-01-01', '1 Street', 'Town')`,
        ),
        NOT_NULL,
      );
    });
  });

  describe("products, claims and drivers", () => {
    it("refuses a vehicle on a home item (decision 6)", async () => {
      const { items } = await makeQuote({ products: ["home"] });
      await expectRefused(
        db().execute(
          sql`insert into vehicles (quote_item_id, make, model, year, variant, fuel_type, doors, insurance_group, value_pence, current_mileage, annual_mileage, usage, overnight_location)
              values (${items[0]!.item.id}, 'VW', 'Golf', 2019, 'Life', 'petrol', 5, 17, 100, 1, 1, 'social', 'street')`,
        ),
        FOREIGN_KEY,
        "vehicles_quote_item_fk",
      );
    });

    it("refuses a vehicle row that claims to be for a home item", async () => {
      const { items } = await makeQuote({ products: ["home"] });
      await expectRefused(
        db().execute(
          sql`insert into vehicles (quote_item_id, product, make, model, year, variant, fuel_type, doors, insurance_group, value_pence, current_mileage, annual_mileage, usage, overnight_location)
              values (${items[0]!.item.id}, 'home', 'VW', 'Golf', 2019, 'Life', 'petrol', 5, 17, 100, 1, 1, 'social', 'street')`,
        ),
        CHECK,
        "vehicles_product_check",
      );
    });

    it("refuses a claim whose customer doesn't own the policy (decision 7)", async () => {
      const policy = await makePolicy();
      const stranger = await makeCustomer();
      await expectRefused(
        makeClaim({ policyId: policy.id, customerId: stranger.id }),
        FOREIGN_KEY,
        "claims_policy_fk",
      );
    });

    it("refuses a second main driver", async () => {
      const { items } = await makeQuote({ products: ["car"] });
      await expectRefused(
        db().insert(drivers).values({
          quoteItemId: items[0]!.item.id,
          isMain: true,
          firstName: "Sam",
          lastName: "Taylor",
          dateOfBirth: "1992-01-01",
          occupation: "nurse",
          licenceYears: 5,
          noClaimsYears: 3,
        }),
        UNIQUE,
        "drivers_one_main_idx",
      );
    });

    it("refuses a policy that ends before it starts", async () => {
      await expectRefused(
        makePolicy({ startsOn: "2026-12-01", endsOn: "2026-11-01" }),
        CHECK,
        "policies_dates_check",
      );
    });

    it("refuses an UPDATE on claim_events (decision 8)", async () => {
      const claim = await makeClaim();
      const [event] = await db()
        .insert(claimEvents)
        .values({ claimId: claim.id, type: "submitted", visibility: "customer" })
        .returning();
      await expectRefused(
        db().update(claimEvents).set({ note: "edited" }).where(eq(claimEvents.id, event!.id)),
        APPEND_ONLY,
      );
    });

    it("still lets deleting a user null out their claim events' actor", async () => {
      const claim = await makeClaim();
      const actor = await makeUser();
      await db()
        .insert(claimEvents)
        .values({ claimId: claim.id, type: "note", visibility: "internal", actorUserId: actor.id });
      await db().delete(users).where(eq(users.id, actor.id));
      const [event] = await db().select().from(claimEvents);
      expect(event?.actorUserId).toBeNull();
    });
  });

  describe("history rows change only through a foreign-key action (decision 8)", () => {
    async function claimWithEvent(actorUserId?: string) {
      const claim = await makeClaim();
      const [event] = await db()
        .insert(claimEvents)
        .values({ claimId: claim.id, type: "note", visibility: "internal", actorUserId })
        .returning();
      return { claim, event: event! };
    }

    it("refuses a direct UPDATE that clears claim_events.actor_user_id", async () => {
      const actor = await makeUser();
      const { event } = await claimWithEvent(actor.id);
      await expectRefused(
        db().update(claimEvents).set({ actorUserId: null }).where(eq(claimEvents.id, event.id)),
        APPEND_ONLY,
      );
    });

    it("refuses a direct DELETE on claim_events, but deleting the claim removes them", async () => {
      const { claim, event } = await claimWithEvent();
      await expectRefused(
        db().delete(claimEvents).where(eq(claimEvents.id, event.id)),
        APPEND_ONLY,
      );
      await db().delete(claims).where(eq(claims.id, claim.id));
      expect(await db().select().from(claimEvents)).toEqual([]);
    });

    it("refuses a direct DELETE on underwriting_decisions, but deleting the quote removes them", async () => {
      const { quote, items } = await makeQuote();
      const [decision] = await db()
        .insert(underwritingDecisions)
        .values({ quoteItemId: items[0]!.item.id, outcome: "quoted" })
        .returning();
      await expectRefused(
        db().delete(underwritingDecisions).where(eq(underwritingDecisions.id, decision!.id)),
        APPEND_ONLY,
      );
      await db().delete(quotes).where(eq(quotes.id, quote.id));
      expect(await db().select().from(underwritingDecisions)).toEqual([]);
    });

    it("tombstones a deleted claim with its events and messages", async () => {
      const { claim, event } = await claimWithEvent();
      const [message] = await db()
        .insert(claimMessages)
        .values({ claimId: claim.id, senderKind: "customer", body: "Any news?" })
        .returning();
      await db().delete(claims).where(eq(claims.id, claim.id));
      const tombstones = (await db().select().from(deletedRows)).map(
        ({ tableName, rowId }) => `${tableName}:${rowId}`,
      );
      expect(tombstones).toEqual(
        expect.arrayContaining([
          `claims:${claim.id}`,
          `claim_events:${event.id}`,
          `claim_messages:${message!.id}`,
        ]),
      );
    });
  });

  describe("change tracking (decision 16)", () => {
    // Tables with a BEFORE UPDATE row trigger calling `fn` (tgtype bit 16 = UPDATE)
    async function updateTriggersCalling(fn: string) {
      const { rows } = await db().execute<{ table: string }>(
        sql`select distinct c.relname as table
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_proc p on p.oid = t.tgfoid
            where p.proname = ${fn} and not t.tgisinternal and (t.tgtype & 16) = 16`,
      );
      return rows.map(({ table }) => table);
    }

    it("refuses UPDATE on every table the contract calls append-only", async () => {
      const appendOnly = Object.entries(dataContract)
        .filter(([, entry]) => entry.kind === "append-only")
        .map(([table]) => table)
        .sort();
      const guarded = [
        ...(await updateTriggersCalling("refuse_change")),
        ...(await updateTriggersCalling("refuse_direct_change")),
      ].sort();
      expect(guarded).toEqual(appendOnly);
    });

    it("has the set_updated_at trigger on every table with an updated_at column", async () => {
      const { rows } = await db().execute<{ table: string }>(
        sql`select table_name as table from information_schema.columns
            where table_schema = 'public' and column_name = 'updated_at'`,
      );
      expect((await updateTriggersCalling("set_updated_at")).sort()).toEqual(
        rows.map(({ table }) => table).sort(),
      );
    });

    it("moves updated_at when a foreign key sets a column to null", async () => {
      const claim = await makeClaim();
      const sender = await makeUser();
      const before = new Date("2026-01-01T00:00:00Z");
      const [message] = await db()
        .insert(claimMessages)
        .values({
          claimId: claim.id,
          senderUserId: sender.id,
          senderKind: "customer",
          body: "Hello",
          createdAt: before,
          updatedAt: before,
        })
        .returning();
      await db().delete(users).where(eq(users.id, sender.id));
      const [after] = await db()
        .select()
        .from(claimMessages)
        .where(eq(claimMessages.id, message!.id));
      expect(after?.senderUserId).toBeNull();
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it("keeps an updated_at the writer sets (the 4.9 seed backdates)", async () => {
      const customer = await makeCustomer();
      const backdated = new Date("2025-12-01T10:00:00Z");
      await db().execute(
        sql`update customers set paperless = false, updated_at = ${backdated.toISOString()} where id = ${customer.id}`,
      );
      const [row] = await db().select().from(customers).where(eq(customers.id, customer.id));
      expect(row!.updatedAt.toISOString()).toBe(backdated.toISOString());
    });
  });

  describe("ownership (composite keys)", () => {
    it("refuses a policy for another customer's quote item", async () => {
      const { quote, items } = await makeQuote();
      const stranger = await makeCustomer();
      await expectRefused(
        makePolicy({ customerId: stranger.id, quoteId: quote.id, quoteItemId: items[0]!.item.id }),
        FOREIGN_KEY,
        "policies_quote_fk",
      );
    });

    it("refuses a policy whose quote item is on a different quote", async () => {
      const customer = await makeCustomer();
      const first = await makeQuote({ customerId: customer.id });
      const second = await makeQuote({ customerId: customer.id });
      await expectRefused(
        makePolicy({
          customerId: customer.id,
          quoteId: second.quote.id,
          quoteItemId: first.items[0]!.item.id,
        }),
        FOREIGN_KEY,
        "policies_quote_item_fk",
      );
    });

    it("refuses a bundle on another customer's quote", async () => {
      const { quote } = await makeQuote();
      const stranger = await makeCustomer();
      await expectRefused(
        db().insert(bundles).values({ customerId: stranger.id, quoteId: quote.id }),
        FOREIGN_KEY,
        "bundles_quote_fk",
      );
    });

    it("refuses a policy in a bundle from a different quote", async () => {
      const customer = await makeCustomer();
      const bundled = await makeQuote({ customerId: customer.id, products: ["car", "home"] });
      const [bundle] = await db()
        .insert(bundles)
        .values({ customerId: customer.id, quoteId: bundled.quote.id })
        .returning();
      const other = await makeQuote({ customerId: customer.id });
      await expectRefused(
        makePolicy({
          customerId: customer.id,
          quoteId: other.quote.id,
          quoteItemId: other.items[0]!.item.id,
          bundleId: bundle!.id,
        }),
        FOREIGN_KEY,
        "policies_bundle_fk",
      );
    });

    it("refuses a car item rated by a home rating version", async () => {
      const { quote } = await makeQuote({ products: ["home"] });
      const homeRates = await makeRatingVersion({ product: "home" });
      await expectRefused(
        db().insert(quoteItems).values({
          quoteId: quote.id,
          product: "car",
          ratingVersionId: homeRates.id,
          outcome: "quoted",
          startDate: "2026-12-01",
        }),
        FOREIGN_KEY,
        "quote_items_rating_version_fk",
      );
    });

    it("refuses a policy that renews itself, or another customer's policy", async () => {
      const policy = await makePolicy();
      await expectRefused(
        db()
          .update(policies)
          .set({ renewalOfPolicyId: policy.id })
          .where(eq(policies.id, policy.id)),
        CHECK,
        "policies_renewal_check",
      );
      const stranger = await makePolicy();
      await expectRefused(
        makePolicy({ customerId: stranger.customerId, renewalOfPolicyId: policy.id }),
        FOREIGN_KEY,
        "policies_renewal_fk",
      );
    });
  });

  describe("statuses agree with their timestamps", () => {
    it("refuses a cancelled policy with no cancelled_at", async () => {
      await expectRefused(
        makePolicy({ status: "cancelled" }),
        CHECK,
        "policies_cancelled_at_check",
      );
    });

    it("refuses a published review with no published_at", async () => {
      const policy = await makePolicy();
      await expectRefused(
        db().insert(reviews).values({
          policyId: policy.id,
          customerId: policy.customerId,
          rating: 5,
          title: "Great",
          body: "Great",
          status: "published",
        }),
        CHECK,
        "reviews_published_at_check",
      );
    });

    it("refuses an accepted quote without a payment plan and both confirmations", async () => {
      await expectRefused(
        makeQuote({ status: "accepted", paymentPlan: "annual", detailsConfirmedAt: new Date() }),
        CHECK,
        "quotes_accepted_check",
      );
    });

    it("refuses a status_changed event with no new status", async () => {
      const claim = await makeClaim();
      await expectRefused(
        db()
          .insert(claimEvents)
          .values({ claimId: claim.id, type: "status_changed", visibility: "customer" }),
        CHECK,
        "claim_events_status_changed_check",
      );
    });

    it("refuses a loading on a declined decision", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(underwritingDecisions).values({
          quoteItemId: items[0]!.item.id,
          outcome: "declined",
          reasonCode: "too_young",
          loadingPercent: 10,
        }),
        CHECK,
        "underwriting_decisions_loading_percent_check",
      );
    });
  });

  describe("underwriting and pricing", () => {
    it("refuses quote totals that don't add up", async () => {
      const { quote } = await makeQuote();
      await expectRefused(
        db()
          .update(quotes)
          .set({ totalPence: quote.totalPence + 1 })
          .where(eq(quotes.id, quote.id)),
        CHECK,
        "quotes_total_check",
      );
    });

    it("refuses a bundle discount above the subtotal", async () => {
      const { quote } = await makeQuote();
      const bundleDiscountPence = quote.subtotalPence + 100;
      await expectRefused(
        db()
          .update(quotes)
          .set({ bundleDiscountPence, totalPence: quote.iptPence - 100 + quote.feesPence })
          .where(eq(quotes.id, quote.id)),
        CHECK,
        "quotes_bundle_discount_check",
      );
    });

    it("refuses an option priced at 0", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(quoteItemOptions).values({
          quoteItemId: items[0]!.item.id,
          coverLevel: "basic",
          coverMultiplier: "1.0000",
          compulsoryExcessPence: 0,
          annualPremiumPence: 0,
          monthlyPremiumPence: 0,
        }),
        CHECK,
        "quote_item_options_premium_check",
      );
    });

    it("refuses a declined item with no reason", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db()
          .update(quoteItems)
          .set({ outcome: "declined" })
          .where(eq(quoteItems.id, items[0]!.item.id)),
        CHECK,
        "quote_items_reason_code_check",
      );
    });

    it("refuses a declined decision with no reason", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db()
          .insert(underwritingDecisions)
          .values({ quoteItemId: items[0]!.item.id, outcome: "declined" }),
        CHECK,
        "underwriting_decisions_reason_code_check",
      );
    });

    it("refuses a loading of 150%", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(underwritingDecisions).values({
          quoteItemId: items[0]!.item.id,
          outcome: "quoted",
          loadingPercent: 150,
        }),
        CHECK,
        "underwriting_decisions_loading_percent_check",
      );
    });

    it("refuses a second active rating version for one product", async () => {
      await makeRatingVersion({ product: "home", status: "active" });
      await expectRefused(
        makeRatingVersion({ product: "home", status: "active" }),
        UNIQUE,
        "rating_versions_one_active_idx",
      );
    });

    it("refuses an UPDATE on underwriting_decisions", async () => {
      const { items } = await makeQuote();
      const [decision] = await db()
        .insert(underwritingDecisions)
        .values({ quoteItemId: items[0]!.item.id, outcome: "quoted" })
        .returning();
      await expectRefused(
        db()
          .update(underwritingDecisions)
          .set({ note: "edited" })
          .where(eq(underwritingDecisions.id, decision!.id)),
        APPEND_ONLY,
      );
    });
  });

  describe("audit log (decision 15)", () => {
    const hashOf = (label: string) => createHash("sha256").update(label).digest("hex");

    async function audit(label: string, prevLabel: string | null = null) {
      const [row] = await db()
        .insert(auditLog)
        .values({
          action: "claim.viewed",
          entityType: "claim",
          entityId: "c1",
          hash: hashOf(label),
          prevHash: prevLabel === null ? null : hashOf(prevLabel),
        })
        .returning();
      return row!;
    }

    it("refuses UPDATE and DELETE", async () => {
      const row = await audit("first");
      await expectRefused(
        db().update(auditLog).set({ reason: "edited" }).where(eq(auditLog.id, row.id)),
        APPEND_ONLY,
      );
      await expectRefused(db().delete(auditLog).where(eq(auditLog.id, row.id)), APPEND_ONLY);
    });

    it("refuses an action not in area.verb form", async () => {
      await expectRefused(
        db()
          .insert(auditLog)
          .values({ action: "viewed", entityType: "claim", entityId: "c1", hash: hashOf("x") }),
        CHECK,
        "audit_log_action_check",
      );
    });

    it("refuses a duplicate hash", async () => {
      await audit("first");
      await expectRefused(audit("first", "first"), UNIQUE, "audit_log_hash_unique");
    });

    it("refuses a second row with no previous hash", async () => {
      await audit("first");
      await expectRefused(audit("second"), UNIQUE, "audit_log_prev_hash_unique");
    });

    it("refuses a fork: two rows on the same previous row", async () => {
      await audit("first");
      await audit("second", "first");
      await expectRefused(audit("rival", "first"), UNIQUE, "audit_log_prev_hash_unique");
    });

    it("refuses a previous hash that isn't in the log", async () => {
      await expectRefused(audit("orphan", "missing"), FOREIGN_KEY, "audit_log_prev_hash_fk");
    });

    it("refuses a hash that isn't 64 hex characters", async () => {
      await expectRefused(
        db()
          .insert(auditLog)
          .values({ action: "claim.viewed", entityType: "claim", entityId: "c1", hash: "h1" }),
        CHECK,
        "audit_log_hash_check",
      );
    });

    it("keeps a user's audit rows when the user is deleted", async () => {
      const user = await makeUser();
      await db()
        .insert(auditLog)
        .values({
          actorUserId: user.id,
          action: "quote.saved",
          entityType: "quote",
          entityId: "q1",
          hash: hashOf("first"),
        });
      await db().delete(users).where(eq(users.id, user.id));
      const rows = await db().select().from(auditLog);
      expect(rows.map((row) => row.actorUserId)).toEqual([user.id]);
    });
  });

  describe("data side (decision 16)", () => {
    it("tombstones a deleted quote, its items and their details, cascades included", async () => {
      const { quote, items } = await makeQuote({ products: ["car", "home"] });
      const [car, home] = items;
      const [driver] = await db()
        .select()
        .from(drivers)
        .where(eq(drivers.quoteItemId, car!.item.id));
      await db().delete(quotes).where(eq(quotes.id, quote.id));

      const rows = await db().select().from(deletedRows);
      const tombstones = rows.map(({ tableName, rowId }) => `${tableName}:${rowId}`);
      expect(tombstones).toEqual(
        expect.arrayContaining([
          `quotes:${quote.id}`,
          `quote_items:${car!.item.id}`,
          `quote_items:${home!.item.id}`,
          `vehicles:${car!.item.id}`,
          `drivers:${driver!.id}`,
          `properties:${home!.item.id}`,
          ...car!.options.map((option) => `quote_item_options:${option.id}`),
        ]),
      );
    });

    it("has the record_delete trigger on every copied table, and only those", async () => {
      const { rows } = await db().execute<{ table: string }>(
        sql`select distinct c.relname as table
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_proc p on p.oid = t.tgfoid
            where p.proname = 'record_delete' and not t.tgisinternal`,
      );
      const copied = Object.entries(dataContract)
        .filter(([, entry]) => entry.copied)
        .map(([table]) => table);
      expect(rows.map(({ table }) => table).sort()).toEqual(copied.sort());
    });

    it("stores the postcode district", async () => {
      const customer = await makeCustomer({ postcode: "SW1A 1AA" });
      expect(customer.postcodeDistrict).toBe("SW1A");
      const spaceless = await makeCustomer({ postcode: "m11ae" });
      expect(spaceless.postcodeDistrict).toBe("M1");
    });

    it("refuses a factor multiplier of 0", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(quoteItemFactors).values({
          quoteItemId: items[0]!.item.id,
          factor: "driver_age",
          inputValue: "25-29",
          multiplier: "0",
        }),
        CHECK,
        "quote_item_factors_multiplier_check",
      );
    });

    it("refuses a review by a customer who doesn't hold the policy", async () => {
      const policy = await makePolicy();
      const stranger = await makeCustomer();
      await expectRefused(
        db().insert(reviews).values({
          policyId: policy.id,
          customerId: stranger.id,
          rating: 5,
          title: "Great",
          body: "Great",
        }),
        FOREIGN_KEY,
        "reviews_policy_fk",
      );
    });

    it("accepts a backdated created_at", async () => {
      const backdated = new Date("2025-11-02T09:00:00Z");
      const [event] = await db()
        .insert(events)
        .values({ name: "quote.started", occurredAt: backdated, createdAt: backdated })
        .returning();
      expect(event?.createdAt.toISOString()).toBe(backdated.toISOString());
    });
  });

  describe("wireframe fields (decision 19)", () => {
    it("refuses a selected option that belongs to another item", async () => {
      const { items } = await makeQuote({ products: ["car", "home"] });
      await expectRefused(
        db()
          .update(quoteItems)
          .set({ selectedOptionId: items[1]!.selected.id })
          .where(eq(quoteItems.id, items[0]!.item.id)),
        FOREIGN_KEY,
        "quote_items_selected_option_fk",
      );
    });

    it("refuses two options with the same tier", async () => {
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(quoteItemOptions).values({
          quoteItemId: items[0]!.item.id,
          coverLevel: "comprehensive",
          coverMultiplier: "1.0000",
          compulsoryExcessPence: 0,
          annualPremiumPence: 100,
          monthlyPremiumPence: 10,
        }),
        UNIQUE,
      );
    });

    it("refuses instalment 13, and instalment 2 on an annual plan", async () => {
      await expectRefused(
        makePayment({ plan: "monthly", instalmentNumber: 13 }),
        CHECK,
        "payments_instalment_number_check",
      );
      await expectRefused(
        makePayment({ plan: "annual", instalmentNumber: 2 }),
        CHECK,
        "payments_instalment_number_check",
      );
    });

    it("refuses a duplicate instalment", async () => {
      const payment = await makePayment();
      await expectRefused(
        makePayment({ customerId: payment.customerId, quoteId: payment.quoteId }),
        UNIQUE,
      );
    });

    it('refuses a card "last four" of 42', async () => {
      await expectRefused(makePayment({ cardLast4: "42" }), CHECK, "payments_card_last4_check");
    });

    it("refuses a succeeded payment with no paid_at", async () => {
      await expectRefused(
        makePayment({ status: "succeeded", paidAt: null }),
        CHECK,
        "payments_paid_at_check",
      );
    });

    it("refuses a payment for a quote that isn't the customer's", async () => {
      const { quote } = await makeQuote();
      const stranger = await makeCustomer();
      await expectRefused(
        makePayment({ quoteId: quote.id, customerId: stranger.id }),
        FOREIGN_KEY,
        "payments_quote_fk",
      );
    });

    it.each([
      ["incidentAt", { incidentAt: null }],
      ["incidentLocation", { incidentLocation: null }],
      ["description", { description: null }],
      ["declarationAcceptedAt", { declarationAcceptedAt: null }],
      ["submittedAt", { submittedAt: null }],
    ])("refuses a claim leaving draft without %s", async (_field, missing) => {
      await expectRefused(
        makeClaim({ status: "received", ...missing }),
        CHECK,
        "claims_submitted_check",
      );
    });

    it("accepts a draft claim with the incident fields empty", async () => {
      const claim = await makeClaim({ status: "draft" });
      expect(claim.incidentAt).toBeNull();
    });

    it("refuses a 2,001-character description", async () => {
      await expectRefused(
        makeClaim({ description: "x".repeat(2001) }),
        CHECK,
        "claims_description_check",
      );
    });

    it("refuses a police reference when the police didn't attend", async () => {
      await expectRefused(
        makeClaim({ policeAttended: false, policeReference: "CAD123" }),
        CHECK,
        "claims_police_reference_check",
      );
    });

    it("refuses a third party with every field empty", async () => {
      const claim = await makeClaim();
      await expectRefused(
        db().insert(claimThirdParties).values({ claimId: claim.id }),
        CHECK,
        "claim_third_parties_any_check",
      );
    });

    it("refuses a settlement whose payout isn't approved − excess", async () => {
      const claim = await makeClaim({ status: "approved" });
      const staff = await makeStaff();
      await expectRefused(
        db().insert(claimSettlements).values({
          claimId: claim.id,
          approvedAmountPence: 100_000,
          excessPence: 25_000,
          payoutPence: 100_000,
          payeeName: "Alex Taylor",
          accountLast4: "1234",
          expectedOn: "2026-12-10",
          approvedBy: staff.userId,
        }),
        CHECK,
        "claim_settlements_payout_check",
      );
    });

    it("refuses a notification linking off-site", async () => {
      const user = await makeUser();
      for (const linkPath of ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x"]) {
        await expectRefused(
          db().insert(notifications).values({
            userId: user.id,
            type: "claim.updated",
            title: "Update",
            body: "Your claim moved on",
            linkPath,
          }),
          CHECK,
          "notifications_link_path_check",
        );
      }
    });

    it("refuses references not in the Figma formats", async () => {
      await expectRefused(makeQuote({ reference: "KRB-Q-123" }), CHECK, "quotes_reference_check");
      await expectRefused(
        makePolicy({ reference: "KRB-C-123456" }),
        CHECK,
        "policies_reference_check",
      );
      await expectRefused(makeClaim({ reference: "KRB-123456" }), CHECK, "claims_reference_check");
    });
  });

  describe("staff (decision 18)", () => {
    it("refuses a customer's user as a claim handler or underwriting decider", async () => {
      const customer = await makeCustomer();
      await expectRefused(
        makeClaim({ assignedHandlerId: customer.userId }),
        FOREIGN_KEY,
        "claims_assigned_handler_id_staff_members_user_id_fk",
      );
      const { items } = await makeQuote();
      await expectRefused(
        db().insert(underwritingDecisions).values({
          quoteItemId: items[0]!.item.id,
          outcome: "quoted",
          decidedBy: customer.userId,
        }),
        FOREIGN_KEY,
        "underwriting_decisions_decided_by_staff_members_user_id_fk",
      );
    });

    it("refuses deleting a user who is staff", async () => {
      const staff = await makeStaff();
      await expectRefused(
        db().delete(users).where(eq(users.id, staff.userId)),
        RESTRICTED,
        "staff_members_user_id_users_id_fk",
      );
    });

    it("refuses an unknown role", async () => {
      const staff = await makeStaff({ roles: [] });
      await expectRefused(
        getDb().insert(staffRoles).values({ userId: staff.userId, role: "superuser" }),
        CHECK,
        "staff_roles_role_check",
      );
    });

    it("refuses the same role twice", async () => {
      const staff = await makeStaff({ roles: ["admin"] });
      await expectRefused(
        getDb().insert(staffRoles).values({ userId: staff.userId, role: "admin" }),
        UNIQUE,
        "staff_roles_pkey",
      );
    });

    it("refuses updating a role row (grant or remove, never edit)", async () => {
      const staff = await makeStaff({ roles: ["admin"] });
      await expectRefused(
        getDb()
          .update(staffRoles)
          .set({ role: "claims_handler" })
          .where(eq(staffRoles.userId, staff.userId)),
        APPEND_ONLY,
      );
    });

    it("records a removed role for the pipeline", async () => {
      const staff = await makeStaff({ roles: ["admin", "claims_handler"] });
      await getDb()
        .delete(staffRoles)
        .where(and(eq(staffRoles.userId, staff.userId), eq(staffRoles.role, "admin")));
      const rows = await getDb()
        .select()
        .from(deletedRows)
        .where(eq(deletedRows.tableName, "staff_roles"));
      expect(rows.map((r) => r.rowId)).toEqual([`${staff.userId}:admin`]);
    });

    it("0007 copies existing roles into staff_roles", async () => {
      const migrations = async (tags: (tag: string) => boolean) => {
        const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
          entries: { tag: string }[];
        };
        const files = journal.entries.map((entry) => entry.tag).filter(tags);
        return Promise.all(
          files.map(async (tag) =>
            (await readFile(`drizzle/${tag}.sql`, "utf8")).split("--> statement-breakpoint"),
          ),
        );
      };
      const apply = async (client: Client, statementsByFile: string[][]) => {
        for (const statements of statementsByFile) {
          for (const statement of statements) await client.query(statement);
        }
      };
      const early = await migrations((tag) => tag < "0007");
      const late = await migrations((tag) => tag >= "0007");

      // A separate database, not a schema: the 0002 functions pin search_path = public
      const name = "kerb_migration_check";
      const admin = new Client({ connectionString: TEST_DATABASE_URL });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.query(`CREATE DATABASE ${name}`);
        const url = new URL(TEST_DATABASE_URL);
        url.pathname = `/${name}`;
        const client = new Client({ connectionString: url.toString() });
        await client.connect();
        try {
          await apply(client, early);
          await client.query(
            `INSERT INTO users (id, name, email) VALUES ('u1', 'Old Staff', 'old@example.test')`,
          );
          await client.query(
            `INSERT INTO staff_members (user_id, role, display_name, staff_code)
             VALUES ('u1', 'admin', 'Sam from Kerb', 'H-001')`,
          );
          await apply(client, late);
          const roles = await client.query(`SELECT user_id, role FROM staff_roles`);
          expect(roles.rows).toEqual([{ user_id: "u1", role: "admin" }]);
          const columns = await client.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'staff_members' AND column_name = 'role'`,
          );
          expect(columns.rows).toEqual([]);
        } finally {
          await client.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        await admin.end();
      }
    });

    it("refuses a duplicate staff code", async () => {
      await makeStaff({ staffCode: "H-001" });
      await expectRefused(
        makeStaff({ staffCode: "H-001" }),
        UNIQUE,
        "staff_members_staff_code_unique",
      );
    });
  });

  describe("ON DELETE", () => {
    it("refuses deleting a customer who has a policy", async () => {
      const policy = await makePolicy();
      await expectRefused(
        db().delete(customers).where(eq(customers.id, policy.customerId)),
        RESTRICTED,
        "policies_customer_id_customers_id_fk",
      );
    });

    it("deleting a draft quote removes its items and details", async () => {
      const { quote, items } = await makeQuote({ products: ["car"] });
      await db().delete(quotes).where(eq(quotes.id, quote.id));
      expect(await db().select().from(quoteItems)).toEqual([]);
      expect(
        await db().select().from(vehicles).where(eq(vehicles.quoteItemId, items[0]!.item.id)),
      ).toEqual([]);
      expect(await db().select().from(drivers)).toEqual([]);
    });

    it("deleting a user removes their sessions", async () => {
      const user = await makeUser();
      await db()
        .insert(sessions)
        .values({
          id: "s1",
          token: "t1",
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
        });
      await db().delete(users).where(eq(users.id, user.id));
      expect(await db().select().from(sessions)).toEqual([]);
    });

    it("refuses deleting a policy that has claims", async () => {
      const claim = await makeClaim();
      await expectRefused(
        db().delete(policies).where(eq(policies.id, claim.policyId)),
        RESTRICTED,
        "claims_policy_fk",
      );
    });
  });
});
