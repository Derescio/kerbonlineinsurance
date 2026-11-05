ALTER TABLE "audit_log" ADD COLUMN "key_version" text NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_key_version_index" ON "audit_log" USING btree ("key_version");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_key_version_check" CHECK ("audit_log"."key_version" ~ '^v[0-9]+$');