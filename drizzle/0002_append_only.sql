-- 4.2 (plan/phases/04-data-auth/02-schema.md, decisions 8, 15 and 16). Hand-written
-- (`drizzle-kit generate --custom`): triggers aren't in the Drizzle schema. TRUNCATE doesn't fire
-- row triggers, so truncateAll() in tests still empties these tables. A table added later gets its
-- triggers in its own migration; constraints.int.test.ts checks every table has the ones the data
-- contract says it needs. Each function pins its search_path, so it resolves the same tables
-- whichever role calls it.

-- Rows that never change. Refused with insufficient_privilege (42501; Postgres already uses 23001
-- for ON DELETE RESTRICT).
CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
	RAISE EXCEPTION '% on % is refused: its rows are append-only', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

-- History rows (decision 8): they change only through a foreign-key action, i.e. a cascade when
-- their claim or quote is deleted, or a SET NULL when the actor's account is. A foreign-key action
-- runs inside Postgres's own trigger, so this one fires nested (depth > 1); a direct UPDATE or
-- DELETE from any client runs at depth 1 and is refused.
CREATE FUNCTION refuse_direct_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
	IF pg_trigger_depth() > 1 THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;
	RAISE EXCEPTION '% on % is refused: its rows change only with their parent', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint

CREATE TRIGGER claim_events_append_only BEFORE UPDATE OR DELETE ON claim_events
	FOR EACH ROW EXECUTE FUNCTION refuse_direct_change();--> statement-breakpoint
CREATE TRIGGER underwriting_decisions_append_only BEFORE UPDATE OR DELETE ON underwriting_decisions
	FOR EACH ROW EXECUTE FUNCTION refuse_direct_change();--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
-- The other tables the data contract calls append-only: their rows may go, but never change
CREATE TRIGGER quote_item_options_append_only BEFORE UPDATE ON quote_item_options
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER quote_item_factors_append_only BEFORE UPDATE ON quote_item_factors
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER bundles_append_only BEFORE UPDATE ON bundles
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE ON events
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER deleted_rows_append_only BEFORE UPDATE ON deleted_rows
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint

-- The pipeline's watermark (decision 16) has to move on every change, including raw SQL and
-- foreign-key SET NULL actions that Drizzle's $onUpdate never sees. A writer that sets updated_at
-- itself (the 4.9 seed backdating history) keeps its value.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
	IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
		NEW.updated_at := now();
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON sessions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER verifications_set_updated_at BEFORE UPDATE ON verifications
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER staff_members_set_updated_at BEFORE UPDATE ON staff_members
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER rating_versions_set_updated_at BEFORE UPDATE ON rating_versions
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER quotes_set_updated_at BEFORE UPDATE ON quotes
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER quote_items_set_updated_at BEFORE UPDATE ON quote_items
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER quote_item_addons_set_updated_at BEFORE UPDATE ON quote_item_addons
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON vehicles
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER drivers_set_updated_at BEFORE UPDATE ON drivers
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON properties
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER businesses_set_updated_at BEFORE UPDATE ON businesses
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER policies_set_updated_at BEFORE UPDATE ON policies
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER claims_set_updated_at BEFORE UPDATE ON claims
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER claim_third_parties_set_updated_at BEFORE UPDATE ON claim_third_parties
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER claim_messages_set_updated_at BEFORE UPDATE ON claim_messages
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER claim_settlements_set_updated_at BEFORE UPDATE ON claim_settlements
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON notifications
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Tombstones for the pipeline (decision 16): every deleted row of a copied table, cascades
-- included, lands in deleted_rows. The trigger's arguments are the table's primary key columns;
-- a composite key is joined with `:`.
CREATE FUNCTION record_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
