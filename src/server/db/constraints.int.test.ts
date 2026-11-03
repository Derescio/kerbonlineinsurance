import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { closeDb, getDb } from "#/server/db/client";
import { dataContract } from "#/server/db/data-contract";
import {
  auditLog,
  claimEvents,
  claimSettlements,
  claimThirdParties,
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
  underwritingDecisions,
  users,
  vehicles,
} from "#/server/db/schema";
import { truncateAll } from "#/test/db";
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
    async function audit(hash: string, prevHash: string | null = "previous") {
      const [row] = await db()
        .insert(auditLog)
        .values({ action: "claim.viewed", entityType: "claim", entityId: "c1", hash, prevHash })
        .returning();
      return row!;
    }

    it("refuses UPDATE and DELETE", async () => {
      const row = await audit("h1");
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
          .values({ action: "viewed", entityType: "claim", entityId: "c1", hash: "h" }),
        CHECK,
        "audit_log_action_check",
      );
    });

    it("refuses a duplicate hash", async () => {
      await audit("same");
      await expectRefused(audit("same"), UNIQUE, "audit_log_hash_unique");
    });

    it("refuses a second row with no previous hash", async () => {
      await audit("first", null);
      await expectRefused(audit("second", null), UNIQUE, "audit_log_one_first_row_idx");
    });

    it("keeps a user's audit rows when the user is deleted", async () => {
      const user = await makeUser();
      await db().insert(auditLog).values({
        actorUserId: user.id,
        action: "quote.saved",
        entityType: "quote",
        entityId: "q1",
        hash: "h1",
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
      for (const linkPath of ["https://evil.example/x", "//evil.example/x"]) {
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
      await expectRefused(makeStaff({ role: "superuser" }), CHECK, "staff_members_role_check");
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
