-- 4.5b (plan/phases/04-data-auth/05b-audit-integrity.md, calls 7 and 8). Hand-written. The app
-- connects as kerb_app; migrations keep the owner (DATABASE_URL_UNPOOLED). Created here, not in
-- Neon's console: console roles join neon_superuser, which can read and write every table
-- (pg_read_all_data, pg_write_all_data). Without LOGIN: each Neon branch sets the password by hand.
-- Safe to run again; changes no data.
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kerb_app') THEN
		CREATE ROLE kerb_app NOLOGIN;
	END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO kerb_app;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM kerb_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kerb_app;--> statement-breakpoint
-- TRUNCATE skips row triggers; TRIGGER and REFERENCES would let the app attach to tables
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM kerb_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM kerb_app;--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO kerb_app;--> statement-breakpoint
-- Tables later migrations create (as this same owner) get the same grants; a table that needs
-- tighter ones revokes them in its own migration, and app-role.int.test.ts lists every table
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kerb_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO kerb_app;--> statement-breakpoint
-- The migrations table; absent when a test replays the SQL files into a bare database
DO $$
BEGIN
	IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'drizzle') THEN
		REVOKE ALL ON SCHEMA drizzle FROM kerb_app;
		REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM kerb_app;
	END IF;
END $$;
