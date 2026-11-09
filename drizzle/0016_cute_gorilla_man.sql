CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" text,
	"kind" text NOT NULL,
	"claim_id" uuid,
	"review_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"object_key" text NOT NULL,
	"thumb_key" text,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"confirmed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "files_kind_check" CHECK ("files"."kind" in ('claim_photo', 'claim_document', 'review_photo')),
	CONSTRAINT "files_status_check" CHECK ("files"."status" in ('pending', 'ready', 'rejected', 'deleted')),
	CONSTRAINT "files_mime_check" CHECK ("files"."mime" in ('image/webp', 'image/jpeg', 'application/pdf')),
	CONSTRAINT "files_size_check" CHECK ("files"."size_bytes" > 0),
	CONSTRAINT "files_dimensions_check" CHECK (("files"."width" is null or "files"."width" > 0) and ("files"."height" is null or "files"."height" > 0)),
	CONSTRAINT "files_parent_check" CHECK ("files"."status" = 'deleted' or ("files"."kind" in ('claim_photo', 'claim_document') and "files"."claim_id" is not null and "files"."review_id" is null) or ("files"."kind" = 'review_photo' and "files"."review_id" is not null and "files"."claim_id" is null)),
	CONSTRAINT "files_confirmed_check" CHECK ("files"."status" <> 'ready' or "files"."confirmed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_user_id_index" ON "files" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "files_claim_id_index" ON "files" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "files_review_id_index" ON "files" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "files_status_created_at_index" ON "files" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "files_updated_at_index" ON "files" USING btree ("updated_at");