CREATE TABLE "rating_addons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_addons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rating_version_id" uuid NOT NULL,
	"addon" text NOT NULL,
	"annual_price_pence" integer NOT NULL,
	"factors" text[] DEFAULT '{}'::text[] NOT NULL,
	"available_to_groups" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_addons_version_addon_unique" UNIQUE("rating_version_id","addon"),
	CONSTRAINT "rating_addons_price_check" CHECK ("rating_addons"."annual_price_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "rating_factors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_factors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rating_version_id" uuid NOT NULL,
	"factor" text NOT NULL,
	"band" text NOT NULL,
	"range_from" bigint,
	"range_to" bigint,
	"multiplier" numeric(8, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_factors_version_factor_band_unique" UNIQUE("rating_version_id","factor","band"),
	CONSTRAINT "rating_factors_multiplier_check" CHECK ("rating_factors"."multiplier" > 0),
	CONSTRAINT "rating_factors_range_check" CHECK ("rating_factors"."range_to" is null or "rating_factors"."range_from" is null or "rating_factors"."range_to" >= "rating_factors"."range_from")
);
--> statement-breakpoint
CREATE TABLE "rating_lookups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_lookups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rating_version_id" uuid NOT NULL,
	"lookup" text NOT NULL,
	"factor" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"group" text,
	"band" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_lookups_version_factor_key_unique" UNIQUE("rating_version_id","factor","key"),
	CONSTRAINT "rating_lookups_lookup_check" CHECK ("rating_lookups"."lookup" in ('postcode_area', 'occupation', 'trade'))
);
--> statement-breakpoint
CREATE TABLE "rating_parameters" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_parameters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rating_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_parameters_version_name_unique" UNIQUE("rating_version_id","name")
);
--> statement-breakpoint
CREATE TABLE "rating_tiers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_tiers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rating_version_id" uuid NOT NULL,
	"cover_level" text NOT NULL,
	"multiplier" numeric(8, 4) NOT NULL,
	"compulsory_excess_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_tiers_version_cover_level_unique" UNIQUE("rating_version_id","cover_level"),
	CONSTRAINT "rating_tiers_cover_level_check" CHECK ("rating_tiers"."cover_level" in ('essential', 'comprehensive', 'plus')),
	CONSTRAINT "rating_tiers_amounts_check" CHECK ("rating_tiers"."multiplier" > 0 and "rating_tiers"."compulsory_excess_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_catalogue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint NOT NULL,
	"variant" text NOT NULL,
	"body_style" text NOT NULL,
	"fuel_type" text NOT NULL,
	"transmission" text NOT NULL,
	"doors" smallint NOT NULL,
	"engine_cc" smallint,
	"power_bhp" smallint NOT NULL,
	"insurance_group" smallint NOT NULL,
	"value_pence" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_catalogue_variant_unique" UNIQUE("make","model","year","variant"),
	CONSTRAINT "vehicle_catalogue_body_style_check" CHECK ("vehicle_catalogue"."body_style" in ('hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv')),
	CONSTRAINT "vehicle_catalogue_fuel_type_check" CHECK ("vehicle_catalogue"."fuel_type" in ('petrol', 'diesel', 'hybrid', 'electric')),
	CONSTRAINT "vehicle_catalogue_transmission_check" CHECK ("vehicle_catalogue"."transmission" in ('manual', 'automatic')),
	CONSTRAINT "vehicle_catalogue_doors_check" CHECK ("vehicle_catalogue"."doors" between 2 and 7),
	CONSTRAINT "vehicle_catalogue_insurance_group_check" CHECK ("vehicle_catalogue"."insurance_group" between 1 and 50),
	CONSTRAINT "vehicle_catalogue_amounts_check" CHECK ("vehicle_catalogue"."value_pence" > 0 and "vehicle_catalogue"."power_bhp" > 0 and ("vehicle_catalogue"."engine_cc" is null or "vehicle_catalogue"."engine_cc" > 0))
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "catalogue_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "rating_versions" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "rating_addons" ADD CONSTRAINT "rating_addons_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_factors" ADD CONSTRAINT "rating_factors_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_lookups" ADD CONSTRAINT "rating_lookups_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_parameters" ADD CONSTRAINT "rating_parameters_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_tiers" ADD CONSTRAINT "rating_tiers_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_catalogue_make_model_year_index" ON "vehicle_catalogue" USING btree ("make","model","year");--> statement-breakpoint
CREATE INDEX "vehicle_catalogue_updated_at_index" ON "vehicle_catalogue" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_catalogue_variant_id_vehicle_catalogue_id_fk" FOREIGN KEY ("catalogue_variant_id") REFERENCES "public"."vehicle_catalogue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_catalogue_variant_id_index" ON "vehicles" USING btree ("catalogue_variant_id");