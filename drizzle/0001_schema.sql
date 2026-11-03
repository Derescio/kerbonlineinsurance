CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changes" jsonb,
	"reason" text,
	"request_id" text,
	"ip_hash" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	CONSTRAINT "audit_log_hash_unique" UNIQUE("hash"),
	CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$')
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "claim_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"claim_id" uuid NOT NULL,
	"type" text NOT NULL,
	"visibility" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_events_type_check" CHECK ("claim_events"."type" in ('submitted', 'status_changed', 'details_checked', 'note', 'file_added', 'settlement_scheduled', 'settlement_paid')),
	CONSTRAINT "claim_events_visibility_check" CHECK ("claim_events"."visibility" in ('customer', 'internal')),
	CONSTRAINT "claim_events_from_status_check" CHECK ("claim_events"."from_status" in ('draft', 'received', 'assessing', 'approved', 'declined', 'settled')),
	CONSTRAINT "claim_events_to_status_check" CHECK ("claim_events"."to_status" in ('draft', 'received', 'assessing', 'approved', 'declined', 'settled'))
);
--> statement-breakpoint
CREATE TABLE "claim_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"claim_id" uuid NOT NULL,
	"sender_user_id" text,
	"sender_kind" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_messages_sender_kind_check" CHECK ("claim_messages"."sender_kind" in ('customer', 'staff')),
	CONSTRAINT "claim_messages_body_check" CHECK (char_length("claim_messages"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "claim_settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"claim_id" uuid NOT NULL,
	"approved_amount_pence" integer NOT NULL,
	"excess_pence" integer NOT NULL,
	"payout_pence" integer NOT NULL,
	"payee_name" text NOT NULL,
	"account_last4" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"expected_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_settlements_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "claim_settlements_amounts_check" CHECK ("claim_settlements"."approved_amount_pence" >= 0 and "claim_settlements"."excess_pence" >= 0 and "claim_settlements"."payout_pence" >= 0),
	CONSTRAINT "claim_settlements_payout_check" CHECK ("claim_settlements"."payout_pence" = greatest("claim_settlements"."approved_amount_pence" - "claim_settlements"."excess_pence", 0)),
	CONSTRAINT "claim_settlements_account_last4_check" CHECK ("claim_settlements"."account_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "claim_settlements_status_check" CHECK ("claim_settlements"."status" in ('scheduled', 'paid')),
	CONSTRAINT "claim_settlements_paid_at_check" CHECK (("claim_settlements"."status" = 'paid') = ("claim_settlements"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "claim_third_parties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"claim_id" uuid NOT NULL,
	"name" text,
	"registration" text,
	"insurer_name" text,
	"policy_number" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_third_parties_any_check" CHECK (num_nonnulls("claim_third_parties"."name", "claim_third_parties"."registration", "claim_third_parties"."insurer_name", "claim_third_parties"."policy_number", "claim_third_parties"."phone") > 0)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"incident_type" text NOT NULL,
	"incident_at" timestamp with time zone,
	"incident_location" text,
	"description" text,
	"declaration_accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"other_vehicle_involved" boolean DEFAULT false NOT NULL,
	"rear_ended" boolean DEFAULT false NOT NULL,
	"injuries" boolean DEFAULT false NOT NULL,
	"police_attended" boolean DEFAULT false NOT NULL,
	"police_reference" text,
	"claimed_amount_pence" integer,
	"assigned_handler_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_reference_unique" UNIQUE("reference"),
	CONSTRAINT "claims_reference_check" CHECK ("claims"."reference" ~ '^KRB-C-[0-9]{5}$'),
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('draft', 'received', 'assessing', 'approved', 'declined', 'settled')),
	CONSTRAINT "claims_incident_type_check" CHECK ("claims"."incident_type" in ('collision', 'theft', 'glass', 'other')),
	CONSTRAINT "claims_description_check" CHECK (char_length("claims"."description") <= 2000),
	CONSTRAINT "claims_submitted_check" CHECK ("claims"."status" = 'draft' or ("claims"."incident_at" is not null and "claims"."incident_location" is not null and "claims"."description" is not null and "claims"."declaration_accepted_at" is not null and "claims"."submitted_at" is not null)),
	CONSTRAINT "claims_police_reference_check" CHECK ("claims"."police_reference" is null or "claims"."police_attended"),
	CONSTRAINT "claims_claimed_amount_check" CHECK ("claims"."claimed_amount_pence" >= 0),
	CONSTRAINT "claims_version_check" CHECK ("claims"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"phone" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"town" text NOT NULL,
	"postcode" text NOT NULL,
	"postcode_district" text GENERATED ALWAYS AS (left(upper(replace(postcode, ' ', '')), -3)) STORED,
	"paperless" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "deleted_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deleted_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"anonymous_id" text,
	"entity_type" text,
	"entity_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_name_check" CHECK ("events"."name" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "events_entity_check" CHECK (("events"."entity_type" is null) = ("events"."entity_id" is null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"sms_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "notifications_link_path_check" CHECK ("notifications"."link_path" ~ '^/' and "notifications"."link_path" !~ '^//')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('queued', 'running', 'done', 'failed', 'dead')),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limits_count_check" CHECK ("rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundles_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"instalment_number" smallint NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"card_brand" text NOT NULL,
	"card_last4" text NOT NULL,
	"due_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_quote_id_instalment_number_unique" UNIQUE("quote_id","instalment_number"),
	CONSTRAINT "payments_plan_check" CHECK ("payments"."plan" in ('annual', 'monthly')),
	CONSTRAINT "payments_instalment_number_check" CHECK ("payments"."instalment_number" between 1 and 12 and ("payments"."plan" = 'monthly' or "payments"."instalment_number" = 1)),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_pence" > 0),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('scheduled', 'succeeded', 'failed', 'refunded')),
	CONSTRAINT "payments_card_last4_check" CHECK ("payments"."card_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payments_paid_at_check" CHECK (("payments"."status" in ('succeeded', 'refunded')) = ("payments"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"bundle_id" uuid,
	"renewal_of_policy_id" uuid,
	"product" text NOT NULL,
	"cover_level" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"annual_premium_pence" integer NOT NULL,
	"compulsory_excess_pence" integer NOT NULL,
	"voluntary_excess_pence" integer DEFAULT 0 NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_reference_unique" UNIQUE("reference"),
	CONSTRAINT "policies_quote_item_id_unique" UNIQUE("quote_item_id"),
	CONSTRAINT "policies_renewal_of_policy_id_unique" UNIQUE("renewal_of_policy_id"),
	CONSTRAINT "policies_id_customer_id_unique" UNIQUE("id","customer_id"),
	CONSTRAINT "policies_reference_check" CHECK ("policies"."reference" ~ '^KRB-[0-9]{6}$'),
	CONSTRAINT "policies_product_check" CHECK ("policies"."product" in ('car', 'home', 'business')),
	CONSTRAINT "policies_status_check" CHECK ("policies"."status" in ('active', 'cancelled', 'lapsed')),
	CONSTRAINT "policies_dates_check" CHECK ("policies"."ends_on" > "policies"."starts_on"),
	CONSTRAINT "policies_amounts_check" CHECK ("policies"."annual_premium_pence" > 0 and "policies"."compulsory_excess_pence" >= 0 and "policies"."voluntary_excess_pence" >= 0),
	CONSTRAINT "policies_version_check" CHECK ("policies"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"quote_item_id" uuid PRIMARY KEY NOT NULL,
	"product" text DEFAULT 'business' NOT NULL,
	"trade_class" text NOT NULL,
	"turnover_pence" integer NOT NULL,
	"employees" integer NOT NULL,
	"cover_sections" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_product_check" CHECK ("businesses"."product" = 'business'),
	CONSTRAINT "businesses_amounts_check" CHECK ("businesses"."turnover_pence" >= 0 and "businesses"."employees" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"product" text DEFAULT 'car' NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"occupation" text NOT NULL,
	"licence_years" smallint NOT NULL,
	"no_claims_years" smallint NOT NULL,
	"past_claims" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_product_check" CHECK ("drivers"."product" = 'car'),
	CONSTRAINT "drivers_history_check" CHECK ("drivers"."licence_years" >= 0 and "drivers"."no_claims_years" >= 0 and "drivers"."past_claims" >= 0)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"quote_item_id" uuid PRIMARY KEY NOT NULL,
	"product" text DEFAULT 'home' NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"town" text NOT NULL,
	"postcode" text NOT NULL,
	"postcode_district" text GENERATED ALWAYS AS (left(upper(replace(postcode, ' ', '')), -3)) STORED,
	"property_type" text NOT NULL,
	"year_built" smallint NOT NULL,
	"bedrooms" smallint NOT NULL,
	"rebuild_cost_pence" integer NOT NULL,
	"contents_value_pence" integer NOT NULL,
	"has_alarm" boolean NOT NULL,
	"has_smoke_alarm" boolean NOT NULL,
	"lock_type" text NOT NULL,
	"past_claims" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_product_check" CHECK ("properties"."product" = 'home'),
	CONSTRAINT "properties_property_type_check" CHECK ("properties"."property_type" in ('detached', 'semi', 'terraced', 'flat', 'bungalow')),
	CONSTRAINT "properties_lock_type_check" CHECK ("properties"."lock_type" in ('standard', 'five_lever', 'multipoint')),
	CONSTRAINT "properties_amounts_check" CHECK ("properties"."bedrooms" >= 0 and "properties"."rebuild_cost_pence" >= 0 and "properties"."contents_value_pence" >= 0 and "properties"."past_claims" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"quote_item_id" uuid PRIMARY KEY NOT NULL,
	"product" text DEFAULT 'car' NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint NOT NULL,
	"variant" text NOT NULL,
	"fuel_type" text NOT NULL,
	"doors" smallint NOT NULL,
	"insurance_group" smallint NOT NULL,
	"value_pence" integer NOT NULL,
	"registration" text,
	"current_mileage" integer NOT NULL,
	"annual_mileage" integer NOT NULL,
	"usage" text NOT NULL,
	"overnight_location" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_product_check" CHECK ("vehicles"."product" = 'car'),
	CONSTRAINT "vehicles_fuel_type_check" CHECK ("vehicles"."fuel_type" in ('petrol', 'diesel', 'hybrid', 'electric')),
	CONSTRAINT "vehicles_doors_check" CHECK ("vehicles"."doors" between 2 and 7),
	CONSTRAINT "vehicles_insurance_group_check" CHECK ("vehicles"."insurance_group" between 1 and 50),
	CONSTRAINT "vehicles_value_check" CHECK ("vehicles"."value_pence" >= 0),
	CONSTRAINT "vehicles_mileage_check" CHECK ("vehicles"."current_mileage" >= 0 and "vehicles"."annual_mileage" > 0),
	CONSTRAINT "vehicles_usage_check" CHECK ("vehicles"."usage" in ('social', 'commuting', 'business')),
	CONSTRAINT "vehicles_overnight_location_check" CHECK ("vehicles"."overnight_location" in ('garage', 'driveway', 'street'))
);
--> statement-breakpoint
CREATE TABLE "quote_item_addons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"addon" text NOT NULL,
	"annual_price_pence" integer NOT NULL,
	"monthly_price_pence" integer NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_item_addons_quote_item_id_addon_unique" UNIQUE("quote_item_id","addon"),
	CONSTRAINT "quote_item_addons_price_check" CHECK ("quote_item_addons"."annual_price_pence" > 0 and "quote_item_addons"."monthly_price_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_item_factors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quote_item_factors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quote_item_id" uuid NOT NULL,
	"factor" text NOT NULL,
	"input_value" text NOT NULL,
	"multiplier" numeric(8, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_item_factors_quote_item_id_factor_unique" UNIQUE("quote_item_id","factor"),
	CONSTRAINT "quote_item_factors_multiplier_check" CHECK ("quote_item_factors"."multiplier" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_item_options" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_item_id" uuid NOT NULL,
	"cover_level" text NOT NULL,
	"cover_multiplier" numeric(8, 4) NOT NULL,
	"compulsory_excess_pence" integer NOT NULL,
	"annual_premium_pence" integer NOT NULL,
	"monthly_premium_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_item_options_quote_item_id_cover_level_unique" UNIQUE("quote_item_id","cover_level"),
	CONSTRAINT "quote_item_options_id_quote_item_id_unique" UNIQUE("id","quote_item_id"),
	CONSTRAINT "quote_item_options_cover_multiplier_check" CHECK ("quote_item_options"."cover_multiplier" > 0),
	CONSTRAINT "quote_item_options_compulsory_excess_check" CHECK ("quote_item_options"."compulsory_excess_pence" >= 0),
	CONSTRAINT "quote_item_options_premium_check" CHECK ("quote_item_options"."annual_premium_pence" > 0 and "quote_item_options"."monthly_premium_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"quote_id" uuid NOT NULL,
	"product" text NOT NULL,
	"rating_version_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"selected_option_id" uuid,
	"voluntary_excess_pence" integer DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_items_quote_id_product_unique" UNIQUE("quote_id","product"),
	CONSTRAINT "quote_items_id_product_unique" UNIQUE("id","product"),
	CONSTRAINT "quote_items_product_check" CHECK ("quote_items"."product" in ('car', 'home', 'business')),
	CONSTRAINT "quote_items_outcome_check" CHECK ("quote_items"."outcome" in ('quoted', 'referred', 'declined')),
	CONSTRAINT "quote_items_reason_code_check" CHECK ("quote_items"."outcome" = 'quoted' or "quote_items"."reason_code" is not null),
	CONSTRAINT "quote_items_voluntary_excess_check" CHECK ("quote_items"."voluntary_excess_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"postcode" text NOT NULL,
	"postcode_district" text GENERATED ALWAYS AS (left(upper(replace(postcode, ' ', '')), -3)) STORED,
	"subtotal_pence" integer DEFAULT 0 NOT NULL,
	"bundle_discount_pence" integer DEFAULT 0 NOT NULL,
	"fees_pence" integer DEFAULT 0 NOT NULL,
	"ipt_pence" integer DEFAULT 0 NOT NULL,
	"total_pence" integer DEFAULT 0 NOT NULL,
	"payment_plan" text,
	"details_confirmed_at" timestamp with time zone,
	"cover_acknowledged_at" timestamp with time zone,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_reference_unique" UNIQUE("reference"),
	CONSTRAINT "quotes_id_customer_id_unique" UNIQUE("id","customer_id"),
	CONSTRAINT "quotes_reference_check" CHECK ("quotes"."reference" ~ '^KRB-Q-[0-9]{5}$'),
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('draft', 'priced', 'referred', 'declined', 'accepted', 'expired')),
	CONSTRAINT "quotes_payment_plan_check" CHECK ("quotes"."payment_plan" in ('annual', 'monthly')),
	CONSTRAINT "quotes_amounts_check" CHECK ("quotes"."subtotal_pence" >= 0 and "quotes"."bundle_discount_pence" >= 0 and "quotes"."fees_pence" >= 0 and "quotes"."ipt_pence" >= 0 and "quotes"."total_pence" >= 0),
	CONSTRAINT "quotes_bundle_discount_check" CHECK ("quotes"."bundle_discount_pence" <= "quotes"."subtotal_pence"),
	CONSTRAINT "quotes_total_check" CHECK ("quotes"."total_pence" = "quotes"."subtotal_pence" - "quotes"."bundle_discount_pence" + "quotes"."fees_pence" + "quotes"."ipt_pence")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"policy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderation_reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_policy_id_unique" UNIQUE("policy_id"),
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" in ('pending', 'published', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"staff_code" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_members_staff_code_unique" UNIQUE("staff_code"),
	CONSTRAINT "staff_members_role_check" CHECK ("staff_members"."role" in ('claims_handler', 'admin')),
	CONSTRAINT "staff_members_staff_code_check" CHECK ("staff_members"."staff_code" ~ '^H-[0-9]{3}$'),
	CONSTRAINT "staff_members_deactivated_at_check" CHECK ("staff_members"."deactivated_at" is null or "staff_members"."deactivated_at" > "staff_members"."started_at")
);
--> statement-breakpoint
CREATE TABLE "rating_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_versions_product_version_unique" UNIQUE("product","version"),
	CONSTRAINT "rating_versions_product_check" CHECK ("rating_versions"."product" in ('car', 'home', 'business')),
	CONSTRAINT "rating_versions_version_check" CHECK ("rating_versions"."version" > 0),
	CONSTRAINT "rating_versions_status_check" CHECK ("rating_versions"."status" in ('draft', 'active', 'retired')),
	CONSTRAINT "rating_versions_effective_to_check" CHECK ("rating_versions"."effective_to" is null or "rating_versions"."effective_to" > "rating_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "underwriting_decisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "underwriting_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quote_item_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"loading_percent" smallint,
	"decided_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "underwriting_decisions_outcome_check" CHECK ("underwriting_decisions"."outcome" in ('quoted', 'referred', 'declined')),
	CONSTRAINT "underwriting_decisions_reason_code_check" CHECK ("underwriting_decisions"."outcome" = 'quoted' or "underwriting_decisions"."reason_code" is not null),
	CONSTRAINT "underwriting_decisions_loading_percent_check" CHECK ("underwriting_decisions"."loading_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_messages" ADD CONSTRAINT "claim_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_settlements" ADD CONSTRAINT "claim_settlements_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_settlements" ADD CONSTRAINT "claim_settlements_approved_by_staff_members_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_members"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_third_parties" ADD CONSTRAINT "claim_third_parties_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_assigned_handler_id_staff_members_user_id_fk" FOREIGN KEY ("assigned_handler_id") REFERENCES "public"."staff_members"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_fk" FOREIGN KEY ("policy_id","customer_id") REFERENCES "public"."policies"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_quote_fk" FOREIGN KEY ("quote_id","customer_id") REFERENCES "public"."quotes"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_renewal_of_policy_id_policies_id_fk" FOREIGN KEY ("renewal_of_policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_quote_item_fk" FOREIGN KEY ("quote_item_id","product") REFERENCES "public"."quote_items"("id","product") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_addons" ADD CONSTRAINT "quote_item_addons_quote_item_id_quote_items_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_factors" ADD CONSTRAINT "quote_item_factors_quote_item_id_quote_items_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_item_options" ADD CONSTRAINT "quote_item_options_quote_item_id_quote_items_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_rating_version_id_rating_versions_id_fk" FOREIGN KEY ("rating_version_id") REFERENCES "public"."rating_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_selected_option_fk" FOREIGN KEY ("selected_option_id","id") REFERENCES "public"."quote_item_options"("id","quote_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_policy_fk" FOREIGN KEY ("policy_id","customer_id") REFERENCES "public"."policies"("id","customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "underwriting_decisions" ADD CONSTRAINT "underwriting_decisions_quote_item_id_quote_items_id_fk" FOREIGN KEY ("quote_item_id") REFERENCES "public"."quote_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "underwriting_decisions" ADD CONSTRAINT "underwriting_decisions_decided_by_staff_members_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff_members"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_one_first_row_idx" ON "audit_log" USING btree (("prev_hash" is null)) WHERE "audit_log"."prev_hash" is null;--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_entity_id_index" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_index" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_index" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_index" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_updated_at_idx" ON "accounts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "claim_events_claim_id_index" ON "claim_events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_events_actor_user_id_index" ON "claim_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "claim_events_created_at_index" ON "claim_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claim_messages_claim_id_created_at_index" ON "claim_messages" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE INDEX "claim_messages_sender_user_id_index" ON "claim_messages" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "claim_messages_updated_at_index" ON "claim_messages" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "claim_settlements_approved_by_index" ON "claim_settlements" USING btree ("approved_by");--> statement-breakpoint
CREATE INDEX "claim_settlements_updated_at_index" ON "claim_settlements" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "claim_third_parties_claim_id_index" ON "claim_third_parties" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claim_third_parties_updated_at_index" ON "claim_third_parties" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "claims_policy_id_index" ON "claims" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "claims_customer_id_index" ON "claims" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "claims_assigned_handler_id_index" ON "claims" USING btree ("assigned_handler_id");--> statement-breakpoint
CREATE INDEX "claims_status_index" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_created_at_index" ON "claims" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "claims_updated_at_index" ON "claims" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "customers_updated_at_index" ON "customers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "deleted_rows_deleted_at_index" ON "deleted_rows" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "events_name_occurred_at_index" ON "events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "events_user_id_index" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_created_at_index" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_index" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_updated_at_index" ON "notifications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_index" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_status_run_after_index" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_created_at_index" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bundles_customer_id_index" ON "bundles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_customer_id_index" ON "payments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_status_index" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_due_on_index" ON "payments" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "payments_updated_at_index" ON "payments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "policies_customer_id_index" ON "policies" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "policies_bundle_id_index" ON "policies" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "policies_status_index" ON "policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policies_created_at_index" ON "policies" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "policies_updated_at_index" ON "policies" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "businesses_updated_at_index" ON "businesses" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_one_main_idx" ON "drivers" USING btree ("quote_item_id") WHERE "drivers"."is_main";--> statement-breakpoint
CREATE INDEX "drivers_quote_item_id_index" ON "drivers" USING btree ("quote_item_id");--> statement-breakpoint
CREATE INDEX "drivers_updated_at_index" ON "drivers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "properties_updated_at_index" ON "properties" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "vehicles_updated_at_index" ON "vehicles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "quote_item_addons_updated_at_index" ON "quote_item_addons" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "quote_items_rating_version_id_index" ON "quote_items" USING btree ("rating_version_id");--> statement-breakpoint
CREATE INDEX "quote_items_outcome_index" ON "quote_items" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "quote_items_updated_at_index" ON "quote_items" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "quotes_customer_id_index" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_status_index" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotes_created_at_index" ON "quotes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quotes_updated_at_index" ON "quotes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "reviews_customer_id_index" ON "reviews" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reviews_status_index" ON "reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reviews_created_at_index" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reviews_updated_at_index" ON "reviews" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "staff_members_role_index" ON "staff_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "staff_members_updated_at_index" ON "staff_members" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_versions_one_active_idx" ON "rating_versions" USING btree ("product") WHERE "rating_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "rating_versions_updated_at_index" ON "rating_versions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_quote_item_id_index" ON "underwriting_decisions" USING btree ("quote_item_id");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_decided_by_index" ON "underwriting_decisions" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "underwriting_decisions_created_at_index" ON "underwriting_decisions" USING btree ("created_at");