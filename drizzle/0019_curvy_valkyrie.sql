-- 5.2 (plan/phases/05-quote/02-vehicle-step.md, call 15): the postcodes.io cache. Rows are only
-- added: kerb_app keeps SELECT and INSERT from the default privileges (0010) and loses the rest,
-- and, like every append-only table, an UPDATE is refused by refuse_change() (0002).
CREATE TABLE "postcode_areas" (
	"postcode" text PRIMARY KEY NOT NULL,
	"outcode" text NOT NULL,
	"admin_district" text,
	"region" text,
	"country" text NOT NULL,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
REVOKE UPDATE, DELETE ON postcode_areas FROM kerb_app;--> statement-breakpoint
CREATE TRIGGER postcode_areas_append_only BEFORE UPDATE ON postcode_areas
	FOR EACH ROW EXECUTE FUNCTION refuse_change();
