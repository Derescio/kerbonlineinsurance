# 4.5b Audit integrity and database security

**Status:** done (merged as #56 on 5 Nov 2026; Neon `dev` set up and `db:check-app-role` 6/6 the same day)
**Phase:** 04-data-auth

## Goal

`audit_log` becomes a record the app can add to but never change. Every row is chained to the one before with a keyed hash (HMAC-SHA256). The key is versioned, so it can be rotated without rewriting history. `verifyAuditChain()` names the first row that was altered or whose link is broken. The app connects to Postgres as a role that can't update, delete or truncate audit rows, and can't remove the triggers that protect them. The first real callers are written here too: staff opening a claim or a referral, and `auth:make-admin` adding a staff member.

`withTx`, `withIdempotency`, `limit()` and the validation-error contract follow in **4.5c**.

## Decisions (agreed 5 Nov 2026)

1. **4.5b is split again** (Damion). 4.5b covers audit integrity and database security. 4.5c covers the safe write tools (`withTx`, `withIdempotency`, `limit()`) and the validation-error contract. Each is tested on its own, and both reach `main` in the Phase 4 release with 4.5.
2. **The keys and logins follow the database, not the Vercel environment** (Damion, option 1). Neon has two branches (engineering.md §2): `prod` serves Production, and `dev` serves Staging, Preview and local development.
   - `dev` gets one HMAC key set and one app login, shared by those three environments.
   - `prod` gets its own key set and login, set on Production only, and never copied anywhere else.
   - That makes two independent chains, each verifiable on its own. Separate keys for Development and Staging would have meant two keys writing into one chain.
3. **Versioned HMAC keys** (Damion):
   - Every row records the key version that signed it.
   - New rows use the active version.
   - Older keys stay available, but only for verification.
   - Rotating never rewrites a historical row.
   - A row whose key version is missing or unknown fails verification and is named in the result. It never counts as passing.
4. **Staff views and `staff.added` are written here** (Claude's recommendation; Damion deferred). `staffGetClaim` writes `claim.viewed`, `staffGetReferral` writes `referral.viewed`, and `auth:make-admin` writes `staff.added`. They're the first real callers of `audit()`, and they close the gap left when 4.5 was split, before the Phase 4 release.
5. **The validation-error contract moves to 4.5c** (agreed). 4.5 is already merged.
6. **The limits of HMAC are written down** (Damion). The chain can't reliably show that the newest rows were deleted, or that the whole database was rolled back to an earlier point: what's left is still a valid chain. Anchoring the latest hash outside the database (4.11) is what closes that gap.

## Calls I've made (check these)

7. **The migration creates the app role; you give it a password.**
   - **Why not the Neon console:** Neon's console makes every role it creates a member of `neon_superuser`, which (as I understand Neon) can write to every table. That would cancel the restrictions. So the role is created in SQL (to confirm against Neon's docs during the build).
   - **What the migration does:** creates `kerb_app` without login rights if it doesn't exist, then sets its grants.
   - **What you do:** run one line in Neon's SQL editor on each branch: `ALTER ROLE kerb_app WITH LOGIN PASSWORD '…'`.
   - **Safety net:** `db:check-app-role` (below) fails if the role belongs to `neon_superuser` or to any `pg_*_data` role.
8. **Exact grants.**
   - **Everywhere:** `kerb_app` gets `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the app's tables, and `USAGE` on their sequences. `TRUNCATE` is revoked on every table, because it skips row triggers. It gets no `CREATE` on the schema and no access to the `drizzle` schema.
   - **`audit_log`:** `SELECT` and `INSERT` only.
   - **Default privileges** make future tables follow the same rules.
   - **Drift check:** a test compares the role's actual privileges against an expected list, so a new table that needs tighter rules can't slip through.
   - **Owner-only:** dropping a trigger, replacing a function and `session_replication_role` all need ownership or superuser, so `kerb_app` can't do them. The tests prove each one.
9. **Two connection strings, as today, with new roles.**
   - `DATABASE_URL` (pooled, used by the app) connects as `kerb_app`.
   - `DATABASE_URL_UNPOOLED` (direct) stays the owner, used by migrations and the deploy step.
   - No new variable is needed.
10. **Integration tests run as `kerb_app`.** The suite's own setup (applying migrations, emptying tables, deliberately tampering for the verification tests) uses an owner connection. Everything else uses the app login, so the whole suite proves the app works with exactly these grants.
11. **Hashing details.**
    - **What the HMAC covers:** a canonical JSON array of a format number, `prev_hash`, `key_version`, `created_at` (ISO, millisecond precision), the actor, role, action, entity, `changes` (keys sorted), `reason`, `request_id` and `ip_hash`.
    - **What `changes` may hold:** strings, booleans, null and safe integers only, so each value round-trips through `jsonb` unchanged.
    - **Locking:** `audit()` takes `pg_advisory_xact_lock` on a fixed key and reads the latest row. It sets `created_at` to the later of the current time and the previous row's time, so it never backdates.
12. **`audit()` fails closed.** If the active key is missing or invalid, `audit()` throws, and the change it records is rolled back with it. A staff member can't open a claim while auditing is broken. Better that than an unaudited view.
13. **Only successful views are logged.** A refused view (not found, conflict of interest) rolls back and writes nothing. Logging refusals is a separate feature, if wanted later.
14. **`actor_role`** records what the actor was at that moment: `customer`, the staff roles joined in order (`admin,claims_handler`), or null for the system.
15. **The hashing code has no dependencies.**
    - `src/server/audit/chain.ts` imports only `node:crypto`, so `scripts/make-admin-core.ts` can import it directly (plain Node, `.ts` extension) and sign `staff.added` with the same code.
    - Staff reads use Drizzle's `db.transaction` directly. 4.5c's `withTx` wraps it later.

## In scope

### Schema (`0009_audit_key_version`, generated; `0010_app_role`, custom)

- **`audit_log.key_version`:** text, not null, with a `CHECK` that it matches `^v[0-9]+$`. `audit_log` has no rows in any environment yet, so not null is safe. Indexed for verification by version.
- **`0010`:**
  - creates `kerb_app NOLOGIN` if it doesn't exist
  - grants and revokes as in call 8, plus default privileges
  - comments in the 0002 style

  It changes no data and is safe to run again.

### Keys (`src/server/env.ts`, `getAuditEnv()`, validated on first use like `getAuthEnv()`)

- **`AUDIT_HMAC_KEYS`:** a comma-separated `version:base64key` list, for example `v1:…,v2:…`. Each key decodes to at least 32 bytes, and each version appears once.
- **`AUDIT_HMAC_ACTIVE_VERSION`:** one of those versions.
- **`.env.example`** gets both, with empty values.

### The chain (`src/server/audit/`)

- **`chain.ts` (pure):**
  - `canonicalPayload(row)`
  - `computeHash(row, key)`
  - `parseKeys(raw)`
  - the format constant
- **`audit.ts`:** `audit(tx, { actor, action, entityType, entityId, changes?, reason?, requestId?, ipHash? })`. It runs inside the caller's transaction:
  1. take the lock
  2. read the latest row
  3. compute `created_at`, then the hash
  4. insert
  5. return the row
- **`verify.ts`:** `verifyAuditChain(db, keys)` reads every row in id order, in batches.
  - **Checks:** the first row has no `prev_hash`; each `prev_hash` equals the previous row's `hash`; each key version is known; each recomputed HMAC equals `hash`.
  - **Result:** `{ ok: true, rows, lastId, lastHash }`, or `{ ok: false, rowId, reason }`, where `reason` is `bad_genesis`, `broken_link`, `unknown_key_version` or `hash_mismatch`.
  - **Why `lastHash`:** it's what 4.11 will anchor.
- **The limitation** (decision 6) is written in a comment in `verify.ts` and in engineering.md §7.

### Callers

- **`staffGetClaim`** and **`staffGetReferral`** run their read and `audit()` in one transaction. They write `claim.viewed` or `referral.viewed`, with the entity id and nothing else.
- **`scripts/make-admin-core.ts`** writes `staff.added` (actor null, entity the user id, `changes: { roles: ["admin"] }`) inside its existing transaction, using the same lock and `chain.ts`. It loads keys from `.env.local` the same way it loads `DATABASE_URL`.

### Checking a branch (`vp run db:check-app-role`)

A script that connects with `DATABASE_URL` and prints a pass or fail line for each check:
- it is connected as `kerb_app`
- the role has no superuser, `CREATEROLE`, `CREATEDB` or `BYPASSRLS`, and doesn't belong to `neon_superuser` or any `pg_*_data` role
- `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` are refused
- the triggers are present
- `verifyAuditChain()` passes

It never prints the URL or the keys. You run it once against `dev` and once against `prod`.

## Out of scope

- **4.5c:** `withTx`, `withIdempotency`, `limit()`, and the validation-error contract.
- **4.11:** anchoring the latest hash outside the database (R2) on a schedule.
- **6.8:** `/admin/audit` and its "Verify chain" button. `verifyAuditChain()` is ready for it.
- **Later:** audit rows for customer actions (6.3), staff decisions (6.10, 6.11), deactivation and role changes (6.8), and account deletion (4.7). Each slice adds its own `audit()` calls.
- Logging refused staff views (call 13).

## What you set up (exact steps follow when the spec is approved)

1. **Generate two key sets:** run `openssl rand -base64 32` once for `dev` and once for `prod`.
2. **Vercel:**
   - `AUDIT_HMAC_KEYS=v1:<dev key>` and `AUDIT_HMAC_ACTIVE_VERSION=v1` on Staging, Preview and Development.
   - The `prod` key on Production only.
   - Run `vercel env pull` afterwards so `.env.local` matches.
3. **After `0010` has run on `dev`:** in Neon's SQL editor, `ALTER ROLE kerb_app WITH LOGIN PASSWORD '<new password>'`. Build the pooled `DATABASE_URL` for `kerb_app`, set it on Staging, Preview and Development, and leave `DATABASE_URL_UNPOOLED` as it is.
4. **Run `vp run db:check-app-role` against `dev`.**
5. **Production, before the Phase 4 release:**
   - Create the role in Neon's SQL editor first, in one line: `CREATE ROLE kerb_app WITH LOGIN PASSWORD '…'` (`0010` then only adds grants).
   - Set Production's `DATABASE_URL` and keys.
   - After the release build, run `db:check-app-role` against `prod`.
6. **Never** paste passwords or keys into the repo, a PR, or a chat.

## Steps

- [x] You approve this spec (5 Nov 2026)
- [x] `chain.ts` with unit tests (canonical form, hash, key parsing, tamper cases)
- [x] `0009`, `0010`, `getAuditEnv()`; the integration suite switched to `kerb_app`, with an owner connection for setup and tampering
- [x] `audit()` and `verifyAuditChain()`, integration tests first
- [x] The privilege tests, and the drift check against the expected grants
- [x] `claim.viewed`, `referral.viewed`, `staff.added`
- [x] `db:check-app-role`
- [x] Docs: engineering.md §3 (two roles), §7 (the chain, keys, rotation, the limitation), §9; `phase.md` (4.5b and a new 4.5c row); `build-plan.md`; `.env.example`
- [x] `vp check`, `vp test`, `vp build`
- [x] Your setup on `dev` (steps 1–4), then a run on staging (Damion, 5 Nov 2026; staging deployed `72b8761` and its build found `0009` and `0010` already applied)

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | Canonical payload is stable (key order in `changes`, nulls, millisecond time); the HMAC changes when any field changes; the same row under another key gives another hash; `parseKeys` refuses short keys, a duplicate version and an active version that isn't listed | yes |
| Integration | `audit()` inside a transaction that then throws leaves no row; the first row has no `prev_hash`; each next row links to the one before; `created_at` never goes backwards | yes |
| Integration | 20 concurrent `audit()` calls give 20 rows in one unbroken chain that verifies | yes |
| Integration | `verifyAuditChain()`: passes on a clean chain; after a field is changed with triggers disabled (owner connection) → `hash_mismatch` at that row; after a middle row is deleted (owner) → `broken_link` at the next row; a row with an unknown key version → `unknown_key_version`; the first row given a `prev_hash` → `bad_genesis` | yes |
| Integration | Rotation: rows signed with `v1`, then with `v2` active, verify with both keys present and fail as `unknown_key_version` when `v1` is removed; no row is rewritten | yes |
| Integration | As `kerb_app`: `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` refused; `DROP TRIGGER`, `ALTER TABLE … DISABLE TRIGGER`, replacing `refuse_change()`, `SET session_replication_role` and `CREATE TABLE` refused; `TRUNCATE` refused on every table | yes |
| Integration | The role's privileges equal the expected list (drift check) | yes |
| Integration | `staffGetClaim` and `staffGetReferral` write one `*.viewed` row each, and none when refused; `auth:make-admin` writes `staff.added`; the chain verifies afterwards | yes |
| Integration | The 4.5 permission suite still passes, now as `kerb_app` | yes |
| Manual | `db:check-app-role` passes on `dev` (and on `prod` at release) | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` pass; `ci` green on #56 (merged 5 Nov 2026).
- [x] The app runs on staging as `kerb_app`, and `db:check-app-role` passes on `dev` (6/6, through the `-pooler` endpoint).
- [ ] Opening a claim as staff on staging writes a `claim.viewed` row, and the chain verifies. No page calls `staffGetClaim` until 6.10; until then `permissions.int.test.ts` proves it as `kerb_app`, and 6.10 ticks this on staging.

## Commit message

`feat: HMAC audit chain with versioned keys, verifyAuditChain, audited staff views and a restricted app database role`

## Sources

- engineering.md §2 (environments to Neon branches), §3 (migrations, two connection strings), §7 (audit log), §9 (logs); 02-schema.md decision 15 and the 4.2 review (M2, M6); 05-authorization.md (decision 2, the staff reads).
- `src/server/db/schema/audit.ts`, `drizzle/0002_append_only.sql`, `src/server/data/{claims,referrals}.ts`, `scripts/make-admin-core.ts`, `src/test/{db,integration.setup}.ts`, `src/server/env.ts`.

## Results (5 Nov 2026, before the PR)

Changes from the spec:
- **`changes` also allows arrays and plain objects** of the allowed scalars, with keys sorted at every depth. `staff.added` needs `{ roles: ["admin"] }`. Strings containing `\u0000` or lone surrogates are refused, in the text fields and in object keys, because they wouldn't round-trip through `jsonb`.
- **`verifyAuditChain` takes a `Queryable`** (a raw `query()` interface), not the Drizzle db, so the plain-Node check script can call it. App code passes `getDb().$client`. It returns `ok`, `rows`, `lastId` and `lastHash`, or `rowId` and `reason`.
- **`db:check-app-role` checks `UPDATE`, `DELETE` and `TRUNCATE` with privilege functions** (`has_table_privilege`) instead of running them, so a misconfigured branch can't lose data to the check. Its results also carry an optional `detail` field, which holds the verify row id and reason. It runs six checks.
- **`0010` guards its `drizzle` schema revoke**, because the 4.5 `0007` replay test applies the SQL files into a bare database, where that schema doesn't exist.
- **`src/server/audit/**` joins the lint rule's allowed database-access folders** (`vite.config.ts`). The value check (`assertChainable`) runs after the lock is taken, still inside the caller's transaction, so a bad value writes nothing.
- **Neon's docs confirmed call 7.** Console, API and CLI roles join `neon_superuser`, which has `pg_read_all_data` and `pg_write_all_data`; roles created in SQL don't. Neon also requires a SQL-set password to have at least 60 bits of entropy (`openssl rand -base64 24` is enough). The docs don't say whether a SQL-created role works through `-pooler`, and setup step 4 proves it on `dev`.
- **`getAuditEnv()` re-parses whenever the raw env strings change** and fails closed.
- **The migrations-count test moved to the owner connection**, and an owner test proves the trigger refuses even the owner.

What was built:
- Server: `src/server/audit/{chain,audit,verify}.ts`. `chain.ts` is pure (only `node:crypto`): the canonical payload, `computeHash`, `assertChainable`, `parseKeys` and `nextCreatedAt`, with `AUDIT_FORMAT = 1` and `AUDIT_LOCK_KEY = 1801810530`. `audit(tx, entry, keys = getAuditEnv())` and `actorRoleOf` are in `audit.ts`; `verifyAuditChain(db, keys, { batchSize })` and the limitation comment are in `verify.ts`.
- Schema: `drizzle/0009_audit_key_version.sql` (`key_version` with its check and index) and `0010_app_role.sql` (`kerb_app` and its grants, default privileges).
- Config: `getAuditEnv()` in `src/server/env.ts`; the Audit block in `.env.example`.
- Callers: `staffGetClaim` and `staffGetReferral` run in a transaction and write `claim.viewed`, or `referral.viewed` with entity type `quote_item`, after their checks. `scripts/make-admin-core.ts` writes `staff.added` under the same lock using `chain.ts`; `make-admin.ts` parses the keys before connecting.
- Scripts: `vp run db:check-app-role` (`scripts/check-app-role{,-core}.ts`).
- Test infrastructure: the integration suite runs as `kerb_app`. `getOwnerDb()`, `tamper()` and the owner `truncateAll()` are in `src/test/db.ts`; the password is set in `integration.setup.ts`, and the URL and keys in the `vite.config.ts` integration env.
- Docs: engineering.md §3, §7 and §9, `phase.md` (4.5b rewritten, 4.5c added), `build-plan.md`.
- Tests: 712 passing (`vp test`): 283 unit, 280 integration, 149 component. Unit: the canonical payload (sorted by string order, so `"10"` before `"2"`), `AuditConfigError` from `getAuditEnv()`, the HMAC for every field, key parsing (pasted-badly cases), `nextCreatedAt`, value refusals. Integration: `app-role.int.test.ts` (privilege refusals and the drift check against `EXPECTED_GRANTS`); `audit.int.test.ts` (rollback, chaining, clock skew, 20 concurrent writers, `jsonb` round trip, fail-closed, verification: `hash_mismatch`, `broken_link`, `unknown_key_version`, `bad_genesis`, a batch boundary; rotation); the staff views and `staff.added`; the 4.5 permission suite, now as `kerb_app`.

Still to do:
- ~~Damion's setup on `dev` (steps 1–4)~~ Done 5 Nov 2026. Both key sets are in Vercel, and the dev set is in `.env.local`. `0009` and `0010` were applied to `dev` with `vp run db:migrate`. `kerb_app` was given a password, and the pooled `DATABASE_URL` was switched to it. `db:check-app-role` passed 6/6 through the `-pooler` endpoint, so a SQL-created role works with Neon's pooler, which the docs didn't say.
  - **Found during setup:** a key needs the `v1:` prefix and 32 bytes (`openssl rand -base64 32`, 44 characters). A `/`, `+` or `=` in the `kerb_app` password must be URL-encoded in `DATABASE_URL`, or the script reports "DATABASE_URL is not a valid URL."
- The staging check (opening a claim as staff writes `claim.viewed`) waits for 6.10, the first page that calls `staffGetClaim`.
- Production's steps (5) come at the Phase 4 release.
