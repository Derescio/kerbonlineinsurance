-- 4.7 (plan/phases/04-data-auth/07-privacy-and-closure.md, call 11). Hand-written
-- (`drizzle-kit generate --custom`). account_closures is a copied, mutable table, so it gets the
-- two triggers every such table has: set_updated_at() (0002) and record_delete('id') (0002).
CREATE TRIGGER account_closures_set_updated_at BEFORE UPDATE ON account_closures
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER account_closures_record_delete AFTER DELETE ON account_closures
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');
