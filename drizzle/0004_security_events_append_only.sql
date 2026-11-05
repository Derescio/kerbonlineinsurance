-- 4.4 (plan/phases/04-data-auth/04-better-auth.md). Hand-written (`drizzle-kit generate --custom`).
-- security_events rows are never edited; they go only with their user (ON DELETE CASCADE, 4.7),
-- so they use 0002's refuse_direct_change(): a cascade fires it nested and passes, a direct UPDATE
-- or DELETE is refused. Not copied to the lakehouse, so no record_delete trigger (data contract).
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
	FOR EACH ROW EXECUTE FUNCTION refuse_direct_change();
