-- 5.6b (plan/phases/05-quote/06b-stripe-payments.md, decision 13): checkout_sessions and
-- stripe_events, the Stripe ids on customers and payments, and policies.lapsed_at.
-- The 0018 rule (dedupe before a unique index): every new unique constraint and index here is on a
-- column or table that is new, so every existing row holds null (or no row) in it and nothing can
-- collide. There is nothing to deduplicate first. Multiple nulls are allowed in a unique column.
-- The generated SQL is unchanged except for the two triggers at the end: checkout_sessions is a
-- copied, mutable table, so it gets set_updated_at() and record_delete('id') (0002), as 0017 did
-- for files. stripe_events has no updated_at and is not copied.
CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stripe_session_id" text NOT NULL,
	"plan" text NOT NULL,
	"starts_on" date NOT NULL,
	"details_confirmed_at" timestamp with time zone NOT NULL,
	"cover_acknowledged_at" timestamp with time zone NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_stripe_session_id_unique" UNIQUE("stripe_session_id"),
	CONSTRAINT "checkout_sessions_plan_check" CHECK ("checkout_sessions"."plan" in ('annual', 'monthly')),
	CONSTRAINT "checkout_sessions_status_check" CHECK ("checkout_sessions"."status" in ('open', 'completed', 'expired', 'refunded')),
	CONSTRAINT "checkout_sessions_amount_check" CHECK ("checkout_sessions"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_invoice_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "lapsed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_quote_fk" FOREIGN KEY ("quote_id","customer_id") REFERENCES "public"."quotes"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_one_open_per_quote" ON "checkout_sessions" USING btree ("quote_id") WHERE "checkout_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "checkout_sessions_customer_id_index" ON "checkout_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stripe_events_received_at_index" ON "stripe_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "payments_stripe_subscription_id_index" ON "payments" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_lapsed_at_check" CHECK ("policies"."lapsed_at" is null or "policies"."status" = 'lapsed');--> statement-breakpoint
CREATE TRIGGER checkout_sessions_set_updated_at BEFORE UPDATE ON checkout_sessions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER checkout_sessions_record_delete AFTER DELETE ON checkout_sessions
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');
