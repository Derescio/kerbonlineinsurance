-- 4.10 (plan/phases/04-data-auth/10-uploads.md, call 18). Hand-written (`drizzle-kit generate --custom`).
-- files is a copied, mutable table, so it gets the two triggers every such table has:
-- set_updated_at() (0002) and record_delete('id') (0002). kerb_app keeps 0010's default grants.
CREATE TRIGGER files_set_updated_at BEFORE UPDATE ON files
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER files_record_delete AFTER DELETE ON files
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');
