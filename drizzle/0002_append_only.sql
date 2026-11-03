-- 4.2 (plan/phases/04-data-auth/02-schema.md, decisions 8, 15 and 16). Hand-written
-- (`drizzle-kit generate --custom`): triggers aren't in the Drizzle schema. TRUNCATE doesn't fire
-- row triggers, so truncateAll() in tests still empties these tables. A table added later gets its
-- triggers in its own migration; the data-contract tests check every copied table has one.

-- Append-only rows. Refuses the trigger's operation (UPDATE, and DELETE for audit_log) with
-- insufficient_privilege (42501; Postgres already uses 23001 for ON DELETE RESTRICT). The
-- trigger's arguments name columns a parent's ON DELETE SET NULL may clear: an UPDATE that only
-- sets those to null is allowed, so deleting an account (4.7) can still null out its user id on
-- claim_events.
CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND TG_NARGS > 0
		AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV)
		AND NOT EXISTS (
			SELECT 1 FROM unnest(TG_ARGV) AS col
			WHERE to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col
				AND to_jsonb(NEW) -> col <> 'null'::jsonb
		)
	THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION '% on % is refused: its rows are append-only', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER claim_events_append_only BEFORE UPDATE ON claim_events
	FOR EACH ROW EXECUTE FUNCTION refuse_change('actor_user_id');--> statement-breakpoint
CREATE TRIGGER underwriting_decisions_append_only BEFORE UPDATE ON underwriting_decisions
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint

-- Tombstones for the pipeline (decision 16): every deleted row of a copied table, cascades
-- included, lands in deleted_rows. The trigger's arguments are the table's primary key columns;
-- a composite key is joined with `:`.
CREATE FUNCTION record_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO deleted_rows (table_name, row_id)
	SELECT TG_TABLE_NAME, string_agg(to_jsonb(OLD) ->> key.col, ':' ORDER BY key.ord)
	FROM unnest(TG_ARGV) WITH ORDINALITY AS key(col, ord);
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER users_record_delete AFTER DELETE ON users
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER accounts_record_delete AFTER DELETE ON accounts
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER customers_record_delete AFTER DELETE ON customers
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER staff_members_record_delete AFTER DELETE ON staff_members
	FOR EACH ROW EXECUTE FUNCTION record_delete('user_id');--> statement-breakpoint
CREATE TRIGGER rating_versions_record_delete AFTER DELETE ON rating_versions
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER underwriting_decisions_record_delete AFTER DELETE ON underwriting_decisions
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER quotes_record_delete AFTER DELETE ON quotes
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER quote_items_record_delete AFTER DELETE ON quote_items
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER quote_item_options_record_delete AFTER DELETE ON quote_item_options
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER quote_item_addons_record_delete AFTER DELETE ON quote_item_addons
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER quote_item_factors_record_delete AFTER DELETE ON quote_item_factors
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER vehicles_record_delete AFTER DELETE ON vehicles
	FOR EACH ROW EXECUTE FUNCTION record_delete('quote_item_id');--> statement-breakpoint
CREATE TRIGGER drivers_record_delete AFTER DELETE ON drivers
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER properties_record_delete AFTER DELETE ON properties
	FOR EACH ROW EXECUTE FUNCTION record_delete('quote_item_id');--> statement-breakpoint
CREATE TRIGGER businesses_record_delete AFTER DELETE ON businesses
	FOR EACH ROW EXECUTE FUNCTION record_delete('quote_item_id');--> statement-breakpoint
CREATE TRIGGER bundles_record_delete AFTER DELETE ON bundles
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER policies_record_delete AFTER DELETE ON policies
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER payments_record_delete AFTER DELETE ON payments
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER claims_record_delete AFTER DELETE ON claims
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER claim_events_record_delete AFTER DELETE ON claim_events
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER claim_third_parties_record_delete AFTER DELETE ON claim_third_parties
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER claim_messages_record_delete AFTER DELETE ON claim_messages
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER claim_settlements_record_delete AFTER DELETE ON claim_settlements
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER reviews_record_delete AFTER DELETE ON reviews
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER audit_log_record_delete AFTER DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER events_record_delete AFTER DELETE ON events
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');--> statement-breakpoint
CREATE TRIGGER notifications_record_delete AFTER DELETE ON notifications
	FOR EACH ROW EXECUTE FUNCTION record_delete('id');
