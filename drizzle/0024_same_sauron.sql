-- 5.7c (plan/phases/05-quote/07c-stored-answers.md, decisions 1–3): drivers keep licence type,
-- employment status and relationship; properties keep the policyholder's employment status and
-- occupation; prior_claims takes car incidents, each type checked against its product's list.
-- The 0018 rule (dedupe before a unique index): no unique constraint or index is added. The new
-- columns are nullable, so existing rows pass, and every existing prior_claims row is a home claim
-- that passes the re-created type check. The generated SQL is unchanged.
ALTER TABLE "prior_claims" DROP CONSTRAINT "prior_claims_type_check";--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "licence_type" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "employment_status" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "relationship" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "employment_status" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_licence_type_check" CHECK ("drivers"."licence_type" is null or "drivers"."licence_type" in ('full_uk', 'full_eu'));--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employment_status_check" CHECK ("drivers"."employment_status" is null or "drivers"."employment_status" in ('employed', 'self_employed', 'retired', 'unemployed', 'student', 'homemaker'));--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_relationship_check" CHECK ("drivers"."relationship" is null or "drivers"."relationship" in ('spouse', 'partner', 'parent', 'child', 'sibling', 'other_relative', 'friend'));--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_main_relationship_check" CHECK (not "drivers"."is_main" or "drivers"."relationship" is null);--> statement-breakpoint
ALTER TABLE "prior_claims" ADD CONSTRAINT "prior_claims_fault_check" CHECK ("prior_claims"."fault" is null or "prior_claims"."fault" in ('at_fault', 'not_at_fault', 'undecided'));--> statement-breakpoint
ALTER TABLE "prior_claims" ADD CONSTRAINT "prior_claims_car_shape_check" CHECK ("prior_claims"."product" <> 'car' or ("prior_claims"."fault" is not null and "prior_claims"."status" is null));--> statement-breakpoint
ALTER TABLE "prior_claims" ADD CONSTRAINT "prior_claims_type_check" CHECK (("prior_claims"."product" = 'car' and "prior_claims"."type" in ('collision', 'theft', 'fire', 'vandalism', 'windscreen', 'other')) or ("prior_claims"."product" = 'home' and "prior_claims"."type" in ('escape_of_water', 'theft', 'accidental_damage', 'storm_flood', 'fire', 'subsidence', 'other')));--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_employment_status_check" CHECK ("properties"."employment_status" is null or "properties"."employment_status" in ('employed', 'self_employed', 'retired', 'unemployed', 'student', 'homemaker'));