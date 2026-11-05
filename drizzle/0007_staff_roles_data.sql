-- 4.5 (plan/phases/04-data-auth/05-authorization.md). Hand-written (`drizzle-kit generate
-- --custom`): a data copy and triggers aren't in the Drizzle schema. Each existing staff member's
-- single role becomes one staff_roles row (granted when they started); 0008 then drops
-- staff_members.role. A role is granted or removed, never edited, so UPDATE is refused with 0002's
-- refuse_change(); a removal lands in deleted_rows for the pipeline (decision 16) with 0002's
-- record_delete(), keyed `user_id:role`.
INSERT INTO staff_roles (user_id, role, granted_at) SELECT user_id, role, started_at FROM staff_members;--> statement-breakpoint
CREATE TRIGGER staff_roles_append_only BEFORE UPDATE ON staff_roles
	FOR EACH ROW EXECUTE FUNCTION refuse_change();--> statement-breakpoint
CREATE TRIGGER staff_roles_record_delete AFTER DELETE ON staff_roles
	FOR EACH ROW EXECUTE FUNCTION record_delete('user_id', 'role');
