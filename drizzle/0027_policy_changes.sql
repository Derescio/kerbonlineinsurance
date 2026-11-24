-- 6.3b (plan/phases/06-account-claims/03b-policy-changes.md, decisions 8 and 9): policy_changes and
-- policy_versions, and version 1 for every policy bought before this slice.
-- The 0018 rule (dedupe before a unique index): both tables are new, so nothing can collide. The
-- backfill inserts only where a policy has no version 1, so a preview or local E2E that wrote one
-- first is left alone, and running it twice inserts nothing the second time.
-- The generated SQL is unchanged except for what follows it: policy_changes is a copied, mutable
-- table (set_updated_at() and record_delete('id') from 0002); policy_versions is copied and
-- append-only (record_delete('id') and refuse_change() on UPDATE, as 0002 did for
-- quote_item_options).
CREATE TABLE "policy_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer,
	"old_annual_pence" integer NOT NULL,
	"new_annual_pence" integer NOT NULL,
	"price_before_pence" integer NOT NULL,
	"price_after_pence" integer NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"settlement" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text DEFAULT 'priced' NOT NULL,
	"failure_reason" text,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_refund_id" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_changes_stripe_session_id_unique" UNIQUE("stripe_session_id"),
	CONSTRAINT "policy_changes_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "policy_changes_stripe_refund_id_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "policy_changes_kind_check" CHECK ("policy_changes"."kind" in ('address', 'driver_added', 'driver_removed', 'cover')),
	CONSTRAINT "policy_changes_outcome_check" CHECK ("policy_changes"."outcome" in ('quoted', 'referred', 'declined')),
	CONSTRAINT "policy_changes_reason_code_check" CHECK ("policy_changes"."reason_code" in ('outside_cover_area', 'vehicle_value_too_high', 'young_driver_high_group', 'high_insurance_group', 'high_vehicle_value', 'past_claims', 'new_licence_high_group', 'driver_age', 'rebuild_cost_too_high', 'high_rebuild_cost', 'high_contents_value', 'old_property', 'high_turnover', 'many_employees', 'high_risk_employees', 'premium_above_max')),
	CONSTRAINT "policy_changes_settlement_check" CHECK ("policy_changes"."settlement" in ('charge', 'refund', 'instalments', 'none')),
	CONSTRAINT "policy_changes_status_check" CHECK ("policy_changes"."status" in ('priced', 'awaiting_payment', 'applied', 'failed', 'abandoned', 'refused')),
	CONSTRAINT "policy_changes_applied_check" CHECK (("policy_changes"."status" = 'applied') = ("policy_changes"."to_version" is not null and "policy_changes"."applied_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"policy_change_id" uuid,
	"snapshot" jsonb NOT NULL,
	"personal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_policy_id_version_unique" UNIQUE("policy_id","version"),
	CONSTRAINT "policy_versions_version_check" CHECK ("policy_versions"."version" >= 1),
	CONSTRAINT "policy_versions_change_check" CHECK (("policy_versions"."version" = 1) = ("policy_versions"."policy_change_id" is null))
);
--> statement-breakpoint
ALTER TABLE "policy_changes" ADD CONSTRAINT "policy_changes_policy_fk" FOREIGN KEY ("policy_id","customer_id") REFERENCES "public"."policies"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_change_id_policy_changes_id_fk" FOREIGN KEY ("policy_change_id") REFERENCES "public"."policy_changes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_changes_one_open_per_policy" ON "policy_changes" USING btree ("policy_id") WHERE "policy_changes"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE INDEX "policy_changes_policy_id_index" ON "policy_changes" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_changes_customer_id_index" ON "policy_changes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "policy_changes_status_index" ON "policy_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policy_changes_updated_at_index" ON "policy_changes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "policy_versions_policy_change_id_index" ON "policy_versions" USING btree ("policy_change_id");--> statement-breakpoint
CREATE INDEX "policy_versions_created_at_index" ON "policy_versions" USING btree ("created_at");--> statement-breakpoint
CREATE TRIGGER policy_changes_set_updated_at BEFORE UPDATE ON policy_changes
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER policy_changes_record_delete AFTER DELETE ON policy_changes
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER policy_versions_record_delete AFTER DELETE ON policy_versions
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER policy_versions_append_only BEFORE UPDATE ON policy_versions
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
-- Version 1 as sold, built as readSnapshot() builds it (src/server/data/policy-version-rows.ts;
-- backfill.int.test.ts checks they agree). Ages are on the day the policy was bought, in London.
-- backfill:start
INSERT INTO policy_versions (policy_id, version, effective_from, policy_change_id, snapshot, personal)
SELECT
	p.id,
	1,
	p.created_at,
	null,
	jsonb_build_object(
		'snapshotVersion', 1,
		'coverLevel', p.cover_level,
		'compulsoryExcessPence', p.compulsory_excess_pence,
		'voluntaryExcessPence', p.voluntary_excess_pence,
		'annualPremiumPence', p.annual_premium_pence,
		'money', jsonb_build_object(
			'tierPence', coalesce(o.annual_premium_pence, 0),
			'addons', coalesce(a.addons, '[]'::jsonb),
			'savingPence', CASE WHEN coalesce(q.bundle_discount_pence, 0) > 0
				THEN greatest(0, coalesce(o.annual_premium_pence, 0) + coalesce(a.total, 0) - p.annual_premium_pence)
				ELSE 0 END,
			'quoteTotalPence', q.total_pence,
			'instalmentPence', CASE WHEN q.payment_plan = 'monthly' AND pay.first IS NOT NULL
				THEN coalesce(pay.second, pay.first) ELSE null END
		),
		'drivers', coalesce(d.drivers, '[]'::jsonb),
		'overnightLocation', v.overnight_location,
		'postcodeDistrict', c.postcode_district
	),
	jsonb_build_object(
		'drivers', coalesce(d.personal, '[]'::jsonb),
		'address', jsonb_build_object(
			'line1', c.address_line1,
			'line2', c.address_line2,
			'town', c.town,
			'postcode', c.postcode
		)
	)
FROM policies p
JOIN customers c ON c.id = p.customer_id
JOIN quotes q ON q.id = p.quote_id
JOIN quote_items i ON i.id = p.quote_item_id
LEFT JOIN quote_item_options o ON o.id = i.selected_option_id
LEFT JOIN vehicles v ON v.quote_item_id = i.id
LEFT JOIN LATERAL (
	SELECT
		jsonb_agg(jsonb_build_object('addon', x.addon, 'annualPricePence', x.annual_price_pence) ORDER BY x.addon) AS addons,
		sum(x.annual_price_pence)::integer AS total
	FROM quote_item_addons x
	WHERE x.quote_item_id = i.id AND x.selected
) a ON true
LEFT JOIN LATERAL (
	SELECT
		jsonb_agg(jsonb_build_object(
			'isMain', dr.is_main,
			'relationship', dr.relationship,
			'licenceYears', dr.licence_years,
			'age', date_part('year', age((p.created_at AT TIME ZONE 'Europe/London')::date, dr.date_of_birth))::integer
		) ORDER BY dr.is_main DESC, dr.created_at, dr.id) AS drivers,
		jsonb_agg(jsonb_build_object(
			'firstName', dr.first_name,
			'lastName', dr.last_name,
			'dateOfBirth', to_char(dr.date_of_birth, 'YYYY-MM-DD')
		) ORDER BY dr.is_main DESC, dr.created_at, dr.id) AS personal
	FROM drivers dr
	WHERE dr.quote_item_id = i.id
) d ON true
LEFT JOIN LATERAL (
	SELECT
		(array_agg(pm.amount_pence ORDER BY pm.instalment_number))[1] AS first,
		(array_agg(pm.amount_pence ORDER BY pm.instalment_number))[2] AS second
	FROM payments pm
	WHERE pm.quote_id = q.id
) pay ON true
WHERE NOT EXISTS (SELECT 1 FROM policy_versions pv WHERE pv.policy_id = p.id AND pv.version = 1);
-- backfill:end
