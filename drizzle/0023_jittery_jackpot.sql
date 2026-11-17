-- 5.7 (plan/phases/05-quote/07-home-steps.md, decision 10): a home's valuables, window locks and
-- alarm on properties, and prior_claims, one row per past claim.
-- The 0018 rule (dedupe before a unique index): no unique constraint or index is added, so there
-- is nothing to deduplicate. The new properties columns are nullable, so existing rows pass the
-- re-created amounts check unchanged.
-- The generated SQL is unchanged except for the two triggers at the end: prior_claims is a copied,
-- mutable table, so it gets set_updated_at() and record_delete('id') (0002), as 0021 did for
-- checkout_sessions.
CREATE TABLE "prior_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"product" text NOT NULL,
	"occurred_on" date NOT NULL,
	"type" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text,
	"fault" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prior_claims_product_check" CHECK ("prior_claims"."product" in ('car', 'home')),
	CONSTRAINT "prior_claims_amount_check" CHECK ("prior_claims"."amount_pence" >= 0),
	CONSTRAINT "prior_claims_type_check" CHECK ("prior_claims"."type" in ('escape_of_water', 'theft', 'accidental_damage', 'storm_flood', 'fire', 'subsidence', 'other')),
	CONSTRAINT "prior_claims_status_check" CHECK ("prior_claims"."status" is null or "prior_claims"."status" in ('settled', 'open', 'withdrawn')),
	CONSTRAINT "prior_claims_home_shape_check" CHECK ("prior_claims"."product" <> 'home' or ("prior_claims"."status" is not null and "prior_claims"."fault" is null))
);
--> statement-breakpoint
ALTER TABLE "properties" DROP CONSTRAINT "properties_amounts_check";--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "valuables_pence" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "window_locks" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "alarm_type" text;--> statement-breakpoint
ALTER TABLE "prior_claims" ADD CONSTRAINT "prior_claims_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prior_claims_quote_item_id_index" ON "prior_claims" USING btree ("quote_item_id");--> statement-breakpoint
CREATE INDEX "prior_claims_updated_at_index" ON "prior_claims" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_window_locks_check" CHECK ("properties"."window_locks" is null or "properties"."window_locks" in ('all_accessible', 'some', 'none'));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_alarm_type_check" CHECK ("properties"."alarm_type" is null or "properties"."alarm_type" in ('none', 'installed_unmonitored', 'monitored'));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_amounts_check" CHECK ("properties"."bedrooms" >= 0 and "properties"."rebuild_cost_pence" >= 0 and "properties"."contents_value_pence" >= 0 and "properties"."past_claims" >= 0 and ("properties"."valuables_pence" is null or "properties"."valuables_pence" >= 0));--> statement-breakpoint
CREATE TRIGGER prior_claims_set_updated_at BEFORE UPDATE ON prior_claims
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER prior_claims_record_delete AFTER DELETE ON prior_claims
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');
