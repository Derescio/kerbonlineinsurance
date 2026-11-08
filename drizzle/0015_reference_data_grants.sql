-- 4.8 (plan/phases/04-data-auth/08-reference-data.md). Hand-written (`drizzle-kit generate --custom`).
-- The six reference tables are copied to the lakehouse, so each gets record_delete('id') (0002);
-- vehicle_catalogue is the only mutable one and also gets set_updated_at(). The rating rows are
-- written once per version and never updated (call 9), so, like every append-only table, an UPDATE
-- is refused by refuse_change(); a draft version's rows can still go with it.
CREATE TRIGGER vehicle_catalogue_set_updated_at BEFORE UPDATE ON vehicle_catalogue
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER vehicle_catalogue_record_delete AFTER DELETE ON vehicle_catalogue
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_parameters_record_delete AFTER DELETE ON rating_parameters
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_tiers_record_delete AFTER DELETE ON rating_tiers
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_addons_record_delete AFTER DELETE ON rating_addons
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_factors_record_delete AFTER DELETE ON rating_factors
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_lookups_record_delete AFTER DELETE ON rating_lookups
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER rating_parameters_append_only BEFORE UPDATE ON rating_parameters
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER rating_tiers_append_only BEFORE UPDATE ON rating_tiers
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER rating_addons_append_only BEFORE UPDATE ON rating_addons
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER rating_factors_append_only BEFORE UPDATE ON rating_factors
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER rating_lookups_append_only BEFORE UPDATE ON rating_lookups
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
-- Read-only to the app (call 18). 0010's default privileges gave kerb_app every write on new
-- tables; the deploy's upsert writes these as the owner (DATABASE_URL_UNPOOLED).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON vehicle_catalogue, rating_parameters, rating_tiers,
	rating_addons, rating_factors, rating_lookups FROM kerb_app;
