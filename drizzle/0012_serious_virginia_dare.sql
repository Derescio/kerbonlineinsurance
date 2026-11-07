CREATE TABLE "account_closures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"held_since" timestamp with time zone,
	"hold_reason" text,
	"closed_at" timestamp with time zone,
	"retain_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_closures_one_ending_check" CHECK ("account_closures"."cancelled_at" is null or "account_closures"."closed_at" is null),
	CONSTRAINT "account_closures_window_check" CHECK ("account_closures"."closes_at" = "account_closures"."requested_at" + interval '30 days')
);
--> statement-breakpoint
ALTER TABLE "account_closures" ADD CONSTRAINT "account_closures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_closures_open_unique" ON "account_closures" USING btree ("user_id") WHERE "account_closures"."cancelled_at" is null and "account_closures"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "account_closures_closes_at_idx" ON "account_closures" USING btree ("closes_at") WHERE "account_closures"."cancelled_at" is null and "account_closures"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "account_closures_user_id_idx" ON "account_closures" USING btree ("user_id");