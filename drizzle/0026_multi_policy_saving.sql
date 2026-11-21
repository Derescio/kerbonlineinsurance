ALTER TABLE "quotes" ADD COLUMN "bundle_policy_id" uuid;--> statement-breakpoint
CREATE INDEX "quotes_bundle_policy_id_index" ON "quotes" USING btree ("bundle_policy_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_bundle_policy_fk" FOREIGN KEY ("bundle_policy_id","customer_id") REFERENCES "public"."policies"("id","customer_id") ON DELETE restrict ON UPDATE no action;