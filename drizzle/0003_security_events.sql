CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"method" text,
	"ip_hash" text,
	"user_agent_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_events_type_check" CHECK ("security_events"."type" in ('sign_up', 'sign_in', 'sign_in_failed', 'rate_limited', 'sign_out', 'password_reset_requested', 'password_reset', 'email_verified', 'google_linked', 'google_link_refused', 'password_removed_on_link')),
	CONSTRAINT "security_events_method_check" CHECK ("security_events"."method" in ('password', 'google')),
	CONSTRAINT "security_events_ip_hash_check" CHECK ("security_events"."ip_hash" is null or "security_events"."ip_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_events_user_id_created_at_index" ON "security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_events_type_created_at_index" ON "security_events" USING btree ("type","created_at");