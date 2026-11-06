# 4.5b Audit integrity and database security: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `audit_log` becomes append-only for the app: rows are HMAC-chained with versioned keys, `verifyAuditChain()` names the first bad row, the app connects as `kerb_app` (no `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log`, no DDL), and staff views and `auth:make-admin` write the first real audit rows.

**Architecture:** `src/server/audit/chain.ts` is pure (only `node:crypto`). It holds the canonical form, the HMAC, key parsing and the `created_at` rule, so the app (`audit.ts`, Drizzle) and the plain-Node scripts (`make-admin-core.ts`, `check-app-role-core.ts`) sign and verify with the same code. `verify.ts` runs on a raw `query()` interface, so the check script can call it too. Migration `0010` creates `kerb_app` and its grants. The integration suite then runs as `kerb_app`, and an owner connection handles setup and tampering.

**Tech Stack:** Drizzle 0.45 + node-postgres, drizzle-kit 0.31, zod 4, Vitest via `vite-plus/test` (projects `unit` and `integration`), Postgres 18 (Docker on `localhost:5433`, CI service container on 5432), scripts under `vp run` (vite-plus's Node, which strips types).

**Spec:** [05b-audit-integrity.md](05b-audit-integrity.md) (approved 5 Nov 2026). It builds on [05-authorization.md](05-authorization.md) and its Results. Read the spec first. This plan only adds what the builder can't decide alone.

## Global Constraints

- **Branch and PR:** branch `slice/4.5b-audit-integrity`, already checked out. One commit per task (Conventional Commits). The PR goes into `staging`, is squash-merged with the spec's commit message, and is opened only when Damion says so. Nothing is pushed before then.
- **Out of scope (4.5c):** `withTx`, `withIdempotency`, `limit()` and the validation-error contract. Staff reads use `db.transaction` directly.
- **Keys:**
  - `AUDIT_HMAC_KEYS` is `version:base64key[,version:base64key…]`. Each version matches `^v[0-9]+$` and appears once, and each key decodes to ≥ 32 bytes.
  - `AUDIT_HMAC_ACTIVE_VERSION` must be one of the listed versions.
  - Neither keys nor URLs are ever printed, logged or put into an error message.
- **Logs:** ids only, never emails, addresses or query values. Server errors go through `logSafeError` (`src/server/auth/errors.ts`).
- **HMAC input:** `JSON.stringify([AUDIT_FORMAT, prevHash, keyVersion, createdAt.toISOString(), actorUserId, actorRole, action, entityType, entityId, canonical(changes), reason, requestId, ipHash])`.
  - `AUDIT_FORMAT = 1`.
  - Absent values are `null`.
  - `canonical` sorts object keys at every depth.
  - The HMAC is SHA-256, written as lowercase hex.
- **`changes` values:** a string, a boolean, `null`, a safe integer, or an array or plain object of those. Anything else is refused before the insert: floats, `NaN`, `undefined`, `Date`, `bigint`, strings containing `\u0000`, and strings that aren't well-formed UTF-16. The text fields follow the same string rule. `{ roles: ["admin"] }` (`staff.added`) is why arrays are allowed; the spec lists only scalars.
- **`created_at`:** `max(now, previous row's created_at)`, at millisecond precision, set by the writer and never by the column default.
- **Lock:** `pg_advisory_xact_lock(AUDIT_LOCK_KEY)`, where `AUDIT_LOCK_KEY = 1801810530` (`0x6b657262`, "kerb"). It is the same key in `audit.ts` and `make-admin-core.ts`.
- **`actor_role`:**
  - `"customer"` for a signed-in actor with no `staff`.
  - The staff roles sorted alphabetically and joined with `,` for staff (`admin,claims_handler`).
  - `null` for the system.
- **Grants:**
  - `kerb_app` gets `SELECT, INSERT, UPDATE, DELETE` on every `public` table, except `audit_log`, which gets `SELECT, INSERT` only.
  - It gets `USAGE` on the `public` sequences and `USAGE` on schema `public`.
  - It gets no `CREATE` on `public`, nothing on schema `drizzle`, and no `TRUNCATE`, `REFERENCES` or `TRIGGER` anywhere.
- **Migrations:** never hand-edit a generated file. Hand-written SQL goes in `drizzle-kit generate --custom`. Comments follow the 0002 style.
- **Script imports:**
  - Scripts and the modules they load (`chain.ts`, `verify.ts`) import relative files with the `.ts` extension. They never use `#/`, because plain Node can't resolve either one.
  - `chain.ts` imports only `node:crypto`. `verify.ts` imports only `./chain.ts`.
- **Tests:**
  - Test imports come from `vite-plus/test`.
  - Integration tests call `truncateAll()` in `beforeEach` and `closeDb()` in `afterAll`.
  - `vp check` and `vp test` pass at the end of every task (`vp run db:test:up` first).

## Review Focus

1. **`changes` that wouldn't round-trip through `jsonb`:**
   - **Inputs:** `1.5`, `NaN`, `2 ** 53`, `undefined`, a `Date`, `"a\u0000b"` and `"\ud800"`.
   - **Expected:** each is refused with `AuditValueError` before any SQL runs, so the row and the change it records roll back together.
   - **Also:** a nested object with emoji and accented text, written and verified, passes.
   - **Tests:** Task 1 (unit) and Task 4 (round trip).
2. **A clock behind the previous row:** another instance's clock runs ahead, or two rows land in the same millisecond. The new row takes the previous row's `created_at`, and the chain verifies. Tests in Task 1 (`nextCreatedAt`) and Task 4 (a faked `Date`).
3. **Keys pasted badly into Vercel:**
   - **Accepted:** surrounding spaces or newlines are trimmed, and spaces around commas are fine.
   - **Refused, with a message naming at most the version:** a trailing comma, an empty value, a missing `:`, base64url characters (`-`, `_`), a key under 32 bytes, and an active version that isn't listed.
   - **Never in the message:** the raw key. Tests in Task 1 and Task 2.
4. **Verification at the edges:**
   - **An empty table:** `{ ok: true, rows: 0, lastId: null, lastHash: null }`.
   - **Tampering at a batch boundary:** with `batchSize: 2` and a broken link at row 3, the result is `broken_link` at row 3. The link check carries across batches.
   - **Ids:** `rowId` and `lastId` are numbers, not the strings pg returns for `bigint`.
   - **Tests:** Task 4.
5. **Keys missing at the moment of a staff view or `make-admin`:**
   - **Expected:** the read throws and returns nothing. No audit row is written, and for `make-admin`, no `staff_members` or `staff_roles` row either.
   - **Never in the error text:** the URL or any key material.
   - **Tests:** Task 6.

---

### Task 0: Commit the spec and the plan

- [ ] **Step 1:** The spec is staged but not yet committed (`git status`: `A plan/phases/04-data-auth/05b-audit-integrity.md`). Commit it with this plan:

```bash
git add plan/phases/04-data-auth/05b-audit-integrity.md plan/phases/04-data-auth/05b-audit-integrity-plan.md
git commit -m "docs: 4.5b spec and implementation plan"
```

---

### Task 1: `chain.ts`, the pure chain

**Files:**
- Create: `src/server/audit/chain.ts`, `src/server/audit/chain.test.ts`

**Interfaces:**
- Produces (all exported from `chain.ts`):
  - **Constants:** `AUDIT_FORMAT = 1`, `AUDIT_LOCK_KEY = 1801810530`.
  - **Values:** `type AuditValue = string | boolean | null | number | AuditValue[] | { [key: string]: AuditValue }`.
  - **The row that gets signed:** `interface ChainRow { prevHash: string | null; keyVersion: string; createdAt: Date; actorUserId: string | null; actorRole: string | null; action: string; entityType: string; entityId: string; changes: Record<string, AuditValue> | null; reason: string | null; requestId: string | null; ipHash: string | null }`.
  - **`canonicalPayload(row: ChainRow): string`.**
  - **`computeHash(row: ChainRow, key: Buffer): string`:** 64 lowercase hex characters.
  - **`assertChainable(row: ChainRow): void`:** throws `AuditValueError` (`name = "AuditValueError"`, `field: string`). The message names the field, never the value.
  - **Keys:** `interface AuditKeys { activeVersion: string; keys: ReadonlyMap<string, Buffer> }`.
  - **`parseKeys(raw: string | undefined, activeVersion: string | undefined): AuditKeys`:** throws `AuditKeyError` (`name = "AuditKeyError"`, `reason: "missing" | "malformed" | "short_key" | "duplicate_version" | "unknown_active_version"`).
  - **`nextCreatedAt(previous: Date | null, now: Date): Date`.**

- [ ] **Step 1: Write the failing tests** in `chain.test.ts`. Use a fixed `row: ChainRow` and two keys, `keyA = Buffer.alloc(32, 1)` and `keyB = Buffer.alloc(32, 2)`:
  - `canonicalPayload` is identical for `changes: { b: 1, a: { d: true, c: null } }` and `changes: { a: { c: null, d: true }, b: 1 }`.
  - It contains `"2026-11-05T10:00:00.123Z"` for `createdAt: new Date("2026-11-05T10:00:00.123Z")`.
  - It starts with `[1,` (the format).
  - `changes: null` and all-null optional fields serialise as JSON `null`.
  - `computeHash(row, keyA)` matches `/^[0-9a-f]{64}$/` and is stable across calls.
  - `computeHash(row, keyA) !== computeHash(row, keyB)`.
  - `it.each` over every `ChainRow` field (`prevHash`, `keyVersion`, `createdAt` +1 ms, each text field, one `changes` value): changing that field changes the hash.
  - `assertChainable` throws `AuditValueError` with `field` set for `changes: { x: 1.5 }`, `{ x: NaN }`, `{ x: 2 ** 53 }`, `{ x: undefined }`, `{ x: new Date() }`, `{ x: "a\u0000b" }` and `{ x: "\ud800" }`, and for `reason: "a\u0000b"`. The message never contains the value. It accepts `{ roles: ["admin"], n: -3, s: "Zoë 🚗", o: { k: null } }`.
  - `parseKeys`:
    - `parseKeys(" v1:<32-byte b64> , v2:<32-byte b64>\n", "v2")` gives `activeVersion "v2"` and two keys.
    - Each of these is refused with the reason shown:

      | Input | Reason |
      |---|---|
      | `undefined` or `""` | `missing` |
      | `"v1:<b64>,"` | `malformed` |
      | `"v1<b64>"` | `malformed` |
      | `"x1:<b64>"` | `malformed` |
      | a base64url key containing `-` or `_` | `malformed` |
      | a 31-byte key | `short_key` |
      | `"v1:k,v1:k"` | `duplicate_version` |
      | active `"v3"` that isn't listed | `unknown_active_version` |
      | active `undefined` | `missing` |

    - No error message contains the key's base64 text.
  - `nextCreatedAt(null, now)` is `now`. `nextCreatedAt(later, now)` is `later`. `nextCreatedAt(earlier, now)` is `now`.

- [ ] **Step 2: Run them to see them fail.** Run `vp test --project unit src/server/audit/chain.test.ts`. Expected: FAIL, because `chain.ts` doesn't exist.

- [ ] **Step 3: Implement `chain.ts`.**
  - `createHmac("sha256", key).update(canonicalPayload(row)).digest("hex")`.
  - Base64 is checked with `/^[A-Za-z0-9+/]+={0,2}$/` before `Buffer.from(…, "base64")`.
  - Strings are checked with `String.prototype.isWellFormed()` and `!s.includes("\u0000")`.
  - Each entry is trimmed.
  - A header comment says why the file imports nothing but `node:crypto` (spec call 15) and why only these value types round-trip through `jsonb` unchanged.

- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/audit/chain.ts src/server/audit/chain.test.ts
git commit -m "feat: canonical audit payload, HMAC and versioned key parsing"
```

---

### Task 2: `key_version` column (`0009`) and `getAuditEnv()`

**Files:**
- Modify: `src/server/db/schema/audit.ts`, `src/server/db/data-contract.ts` (add `key_version` to `audit_log`'s `keep(...)`), `src/server/db/constraints.int.test.ts` (the `audit()` helper near line 598 sets `keyVersion: "v1"`), `src/server/env.ts`, `src/server/env.test.ts` (create if absent), `.env.example`
- Create: `drizzle/0009_audit_key_version.sql` (`pnpm exec drizzle-kit generate --name audit_key_version`)

**Interfaces:**
- Consumes: `parseKeys` and `AuditKeys` (Task 1).
- Produces:
  - **The column:** `auditLog.keyVersion` (`text`, not null), with `check("audit_log_key_version_check", sql\`${t.keyVersion} ~ '^v[0-9]+$'\`)` and `index().on(t.keyVersion)`.
  - **`getAuditEnv(source = process.env): AuditKeys`** in `env.ts`.
    - It caches on the raw pair of strings: it re-parses when either string differs from the cached one. That way a test (or a rotation) that changes `process.env` is seen, and a missing key always throws.
    - It wraps `AuditKeyError` as `Error("Invalid audit environment (.env.example, \"Audit (4.5b)\"): <reason>")`.

- [ ] **Step 1: Write the failing tests.**
  - **In `constraints.int.test.ts`,** `describe("audit log (decision 15)")`: `it("refuses a key version that isn't v<number>")` inserts `keyVersion: "1"` and `expectRefused(..., CHECK, "audit_log_key_version_check")`.
  - **In `env.test.ts`:**
    - `getAuditEnv({ AUDIT_HMAC_KEYS: "v1:<b64>", AUDIT_HMAC_ACTIVE_VERSION: "v1" })` returns `activeVersion "v1"`.
    - `getAuditEnv({})` throws a message containing `"Audit (4.5b)"` and `"missing"`.
    - After a valid call, a call with `AUDIT_HMAC_ACTIVE_VERSION` changed to an unlisted version throws, so the cache doesn't hide the change.

- [ ] **Step 2: Run them to see them fail.** Run `vp test src/server/env.test.ts src/server/db/constraints.int.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement the schema change, then generate `0009`.**
  - Update the `audit.ts` comments: the hash is `HMAC-SHA256(key[key_version], canonical row)` (4.5b), not `sha256`.
  - Add `getAuditEnv`.
  - Add this to `.env.example`, after Auth:

```
# Audit (4.5b): HMAC keys for the audit chain. One set for Neon `dev` (Development, Preview,
# Staging) and one for `prod` (Production only). `openssl rand -base64 32` per key.
# Rotate by adding v2 and making it active; keep v1 listed so old rows still verify.
AUDIT_HMAC_KEYS=
AUDIT_HMAC_ACTIVE_VERSION=
```

- [ ] **Step 4: Run the tests to see them pass,** plus `vp run db:check`. Expected: PASS, with no drift.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/audit.ts src/server/db/data-contract.ts src/server/db/constraints.int.test.ts src/server/env.ts src/server/env.test.ts .env.example drizzle/
git commit -m "feat: audit_log.key_version and getAuditEnv()"
```

---

### Task 3: `kerb_app` role (`0010`), with the suite running as it

**Files:**
- Create: `drizzle/0010_app_role.sql` (`pnpm exec drizzle-kit generate --custom --name app_role`)
- Modify: `src/test/integration.setup.ts`, `src/test/db.ts`, `vite.config.ts` (integration `env`), `src/server/db/db.int.test.ts`, `src/server/db/constraints.int.test.ts`

**Interfaces:**
- Produces:
  - **Role:** `kerb_app`, with the grants in Global Constraints.
  - **In `src/test/db.ts`:**
    - `TEST_DATABASE_URL`: unchanged, and still the owner.
    - `getOwnerDb(): Db`: a Drizzle instance over a `Pool` on `TEST_DATABASE_URL` with `allowExitOnIdle: true`, so files don't have to close it.
    - `truncateAll()`: now runs on `getOwnerDb()`.
    - `tamper(statement: string, values?: unknown[]): Promise<void>`: one owner transaction with `set local session_replication_role = replica`, which skips the triggers and the `prev_hash` foreign key.
  - **Integration env:** `DATABASE_URL` is `TEST_DATABASE_URL` with `username = "kerb_app"` and `password = "kerb_app"` (built with `new URL` in `vite.config.ts`). The integration `env` also gets `AUDIT_HMAC_KEYS: "v1:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="` (`Buffer.alloc(32, 1)`) and `AUDIT_HMAC_ACTIVE_VERSION: "v1"`.

`0010` (the grants are fixed by the spec, so here they are):

```sql
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
```

- [ ] **Step 1: Write the failing tests.**
  - **In `db.int.test.ts`:**
    - `it("connects as kerb_app")`: `select current_user` through `getDb()` gives `"kerb_app"`.
    - The migrations-count test moves to `getOwnerDb()`. `kerb_app` can't read `drizzle`; Task 5 proves that.
  - **In `constraints.int.test.ts`,** `describe("audit log (decision 15)")`: `it("refuses even the owner an update or delete (the trigger, not only the grants)")`. Run the update and the delete through `getOwnerDb()` and `expectRefused(..., APPEND_ONLY)`. Both are refused with `42501` from `refuse_change()`, and the error message contains `"is refused: its rows are append-only"`, so a permission error can't pass for the trigger.

- [ ] **Step 2: Run them to see them fail.** Run `vp test --project integration src/server/db/db.int.test.ts`. Expected: FAIL, `current_user` is `postgres`.

- [ ] **Step 3: Implement.**
  - Write `0010` (above).
  - In `integration.setup.ts`, after `migrate`, run `alter role kerb_app with login password 'kerb_app'`. Its comment says the test role's password is public on purpose: it exists only in the Docker and CI databases.
  - Add `getOwnerDb` and `tamper`, and switch `truncateAll` to the owner.
  - Set the integration `env` in `vite.config.ts`.
  - The `0007` replay test applies the `>= "0007"` files, which now include `0009` and `0010`, into a bare database as `postgres`. `0010`'s `drizzle` guard keeps it working. Don't narrow the test.

- [ ] **Step 4: Run the whole suite to see it pass.** Run `vp test`. Expected: PASS, with every existing integration test (the 4.5 permission suite included) now running as `kerb_app`. If any fails on a privilege, the test was relying on owner rights: move only that test's setup to `getOwnerDb()`, and never widen the grants.

- [ ] **Step 5: Commit**

```bash
git add drizzle/ src/test/ vite.config.ts src/server/db/db.int.test.ts src/server/db/constraints.int.test.ts
git commit -m "feat: kerb_app database role; integration suite runs as it"
```

---

### Task 4: `audit()` and `verifyAuditChain()`

**Files:**
- Create: `src/server/audit/audit.ts`, `src/server/audit/verify.ts`, `src/server/audit/audit.int.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `chain.ts` (all of it).
  - From Task 2: `getAuditEnv()`.
  - From Task 3: `tamper()` and `getOwnerDb()`.
  - From 4.5: `Actor` (`#/server/auth/actor`) and `Db` (`#/server/db/client`).
- Produces:
  - **In `audit.ts`:**
    - `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]`.
    - `interface AuditEntry { actor: Actor | null; action: string; entityType: string; entityId: string; changes?: Record<string, AuditValue>; reason?: string; requestId?: string; ipHash?: string }`.
    - `actorRoleOf(actor: Actor | null): string | null`.
    - `audit(tx: Tx, entry: AuditEntry, keys: AuditKeys = getAuditEnv()): Promise<typeof auditLog.$inferSelect>`.
      - Steps: take the lock (`sql\`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)\``), read the latest `hash, created_at` by `id desc limit 1`, then `nextCreatedAt`, `assertChainable`, `computeHash` with `keys.keys.get(keys.activeVersion)`, then insert `returning`.
      - The default argument is evaluated per call, so missing keys throw inside the caller's transaction.
  - **In `verify.ts`:**
    - `interface Queryable { query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> }`. A `pg` `Pool` or `Client` satisfies it, and app code passes `getDb().$client`.
    - `type VerifyResult = { ok: true; rows: number; lastId: number | null; lastHash: string | null } | { ok: false; rowId: number; reason: "bad_genesis" | "broken_link" | "unknown_key_version" | "hash_mismatch" }`.
    - `verifyAuditChain(db: Queryable, keys: Pick<AuditKeys, "keys">, options?: { batchSize?: number }): Promise<VerifyResult>`.
      - It uses keyset batches: `where id > $1 order by id limit $2`, default 500.
      - It checks each row in this order: genesis, link, key version, HMAC.
      - Its header comment carries the limitation (spec decision 6): deleting the newest rows, or rolling the whole database back, leaves a valid chain, and 4.11's external anchor of `lastHash` is what closes that gap.

- [ ] **Step 1: Write the failing tests** in `audit.int.test.ts`. Use `getDb()` (`kerb_app`) and the test keys. `v1 = parseKeys(process.env.AUDIT_HMAC_KEYS, "v1")`, and `entry()` builds a minimal `AuditEntry` (`action: "claim.viewed"`, `entityType: "claim"`, `entityId: randomUUID()`).
  - `"rolls back with the caller's transaction"`: `audit()` inside `getDb().transaction` that then throws leaves 0 rows.
  - `"starts the chain with no prev_hash, then links each row to the one before"`: 3 sequential calls. Row 1 has `prevHash === null`, and each row's `prevHash` is the previous row's `hash`.
  - `"never moves created_at backwards"`: write a row, then `vi.useFakeTimers({ toFake: ["Date"] })` with `vi.setSystemTime` 1 hour earlier, then write another. The second row's `createdAt` equals the first's, and `verifyAuditChain` is ok. Restore the timers.
  - `"keeps one chain under 20 concurrent writers"`: `Promise.all` of 20 `getDb().transaction(tx => audit(tx, entry()))`. That gives 20 rows, and `verifyAuditChain(getOwnerDb().$client, v1)` is `{ ok: true, rows: 20 }`, with `lastId` and `lastHash` from the newest row.
  - `"records actor_role"`: as follows.

    | Actor | `actor_role` |
    |---|---|
    | `null` | `null` |
    | a customer actor | `"customer"` |
    | staff with `["claims_handler", "admin"]` | `"admin,claims_handler"` |

    `actor_user_id` is the actor's `userId`.
  - `"round-trips changes through jsonb"`: `changes: { roles: ["admin"], note: "Zoë 🚗", nested: { b: 1, a: null } }` verifies ok.
  - `"refuses an unchainable value before writing"`: `changes: { x: 1.5 }` rejects with `AuditValueError`, and there are 0 rows.
  - `"refuses to write without keys (fails closed)"`: with `vi.stubEnv("AUDIT_HMAC_KEYS", "")`, `audit(tx, entry())` (default keys) rejects inside the transaction and leaves 0 rows. Unstub afterwards.
  - `describe("verifyAuditChain")`:
    - An empty table gives `{ ok: true, rows: 0, lastId: null, lastHash: null }`.
    - Clean, 5 rows: ok.
    - `tamper("update audit_log set reason = 'edited' where id = $1", [id3])` gives `{ ok: false, rowId: id3, reason: "hash_mismatch" }`.
    - `tamper("delete from audit_log where id = $1", [id3])` gives `broken_link` at `id4`.
    - `tamper("update audit_log set key_version = 'v9' where id = $1", [id2])` gives `unknown_key_version` at `id2`.
    - `tamper("update audit_log set prev_hash = repeat('a', 64) where id = $1", [id1])` gives `bad_genesis` at `id1`.
    - With `batchSize: 2`, the delete of `id3` still gives `broken_link` at `id4`.
    - `rowId` is `typeof "number"`.
  - `"rotation"`:
    - Write 2 rows with the keys `v1`. Then write 2 with `parseKeys("v1:<k1>,v2:<k2>", "v2")`.
    - The rows' `keyVersion` values are `["v1", "v1", "v2", "v2"]`.
    - Verifying with both keys is ok.
    - Verifying with `parseKeys("v2:<k2>", "v2")` gives `unknown_key_version` at row 1.
    - Every row's `hash` is unchanged from before the rotation.

- [ ] **Step 2: Run them to see them fail.** Run `vp test --project integration src/server/audit/audit.int.test.ts`. Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `audit.ts` and `verify.ts`.** In `verify.ts`, `bigint` ids come back from pg as strings, so convert them with `Number()`. Selected `changes` come back parsed. `created_at` comes back as a `Date`.

- [ ] **Step 4: Run the tests to see them pass.** Same command, then `vp test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/audit/
git commit -m "feat: audit() writes the HMAC chain under an advisory lock; verifyAuditChain names the first bad row"
```

---

### Task 5: Privilege tests and the drift check

**Files:**
- Create: `src/server/db/app-role.int.test.ts`

**Interfaces:**
- Consumes: `getDb()` (`kerb_app`) and `getOwnerDb()`, both from Task 3.
- Produces: `EXPECTED_GRANTS: Record<string, readonly ("SELECT" | "INSERT" | "UPDATE" | "DELETE")[]>`, an explicit entry for **every** `public` table, local to the test.

- [ ] **Step 1: Write the tests.** Each probe runs in its own `getDb().transaction` that is always rolled back, so an unexpected success changes nothing. Each one expects SQLSTATE `42501`.
  - **`it.each` over these statements:**
    - `update audit_log set reason = reason where false`
    - `delete from audit_log where false`
    - `truncate audit_log`
    - `drop trigger audit_log_append_only on audit_log`
    - `alter table audit_log disable trigger audit_log_append_only`
    - `create or replace function refuse_change() returns trigger language plpgsql as $$ begin return null; end $$`
    - `set session_replication_role = replica`
    - `create table kerb_app_probe (id int)`
    - `select * from drizzle.__drizzle_migrations`
  - **`it("refuses TRUNCATE on every table")`:** loop over `pg_tables where schemaname = 'public'` and expect `42501` for each.
  - **`it("holds exactly the expected privileges (drift check)")`:**
    - **Input:** query `information_schema.role_table_grants` where `grantee = 'kerb_app' and table_schema = 'public'`, grouped per table, privileges sorted.
    - **Expected:** it equals `EXPECTED_GRANTS` with each list sorted. Every table gets all four privileges except `audit_log: ["INSERT", "SELECT"]`.
    - **Also:** every name in `pg_tables` (public) is a key of `EXPECTED_GRANTS`, and the reverse. That is what makes a new table fail until someone chooses its grants.
  - **`it("has no role attributes or memberships")`:**
    - **The role:** `pg_roles` for `kerb_app` has `rolsuper`, `rolcreaterole`, `rolcreatedb` and `rolbypassrls` all false.
    - **Memberships:** `select count(*) from pg_auth_members where member = 'kerb_app'::regrole` is 0.
    - **Schemas:** `has_schema_privilege('kerb_app', 'public', 'CREATE')` is false and `has_schema_privilege('kerb_app', 'drizzle', 'USAGE')` is false.
    - **Sequences:** `has_sequence_privilege` is true for `USAGE` on each `public` sequence.

- [ ] **Step 2: Run them.** Run `vp test --project integration src/server/db/app-role.int.test.ts`. Expected: PASS against Task 3's grants. To prove the drift check bites, temporarily remove `audit_log` from `EXPECTED_GRANTS`, see the test FAIL, then restore it.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/app-role.int.test.ts
git commit -m "test: kerb_app privilege refusals and the expected-grants drift check"
```

---

### Task 6: `claim.viewed`, `referral.viewed`, `staff.added`

**Files:**
- Modify: `src/server/data/claims.ts` (`staffGetClaim`), `src/server/data/referrals.ts` (`staffGetReferral`), `src/server/data/permissions.int.test.ts`, `scripts/make-admin-core.ts`, `scripts/make-admin.ts`, `scripts/make-admin.int.test.ts`

**Interfaces:**
- Consumes:
  - From Task 4: `audit()`, `verifyAuditChain()`.
  - From Task 1: `chain.ts` (`AUDIT_LOCK_KEY`, `nextCreatedAt`, `assertChainable`, `computeHash`, `parseKeys`, `AuditKeys`), imported as `../src/server/audit/chain.ts` in the scripts.
- Produces:
  - **`staffGetClaim`:** its `run` is wrapped in `db.transaction(async (tx) => …)`. Reads use `tx`. After `assertNoConflict`, it calls `audit(tx, { actor, action: "claim.viewed", entityType: "claim", entityId: claimId })`.
  - **`staffGetReferral`:** the same, with `action: "referral.viewed"`, `entityType: "quote_item"` and `entityId: quoteItemId`.
  - **Neither** sets `changes`, `reason`, `requestId` or `ipHash`. The reads have no request context yet; the pages that call them can add it later.
  - **`makeAdmin(client, email, displayName, keys: AuditKeys)`:** inside its existing transaction, after the role insert:
    1. Take the lock.
    2. Read the latest row.
    3. Insert `audit_log` with `action "staff.added"`, `entity_type "user"`, `entity_id` set to the user id, `actor_user_id` and `actor_role` null, and `changes {"roles":["admin"]}` (passed as `JSON.stringify` of the same object that was hashed).
  - **`make-admin.ts`:** after loading `.env.local`, it calls `parseKeys(process.env.AUDIT_HMAC_KEYS, process.env.AUDIT_HMAC_ACTIVE_VERSION)` before connecting. On `AuditKeyError` it prints `Audit keys are not set or invalid (<reason>): see .env.example, "Audit (4.5b)".` and exits 1.

- [ ] **Step 1: Write the failing tests.**
  - **In `permissions.int.test.ts`,** `describe("audit of staff views (4.5b)")`:
    - A handler opening A's claim writes exactly one row: `{ action: "claim.viewed", entityType: "claim", entityId: claim.id, actorUserId: handler.userId, actorRole: "claims_handler", changes: null }`.
    - The same for a referral, with `"referral.viewed"` and `"quote_item"`.
    - These write 0 rows: an admin opening their own claim or referral (`CONFLICT_OF_INTEREST`), a random UUID (`NOT_FOUND`), and a customer (`FORBIDDEN`).
    - `verifyAuditChain(getOwnerDb().$client, keys)` is ok after a mix of views.
    - With `vi.stubEnv("AUDIT_HMAC_KEYS", "")`, `staffGetClaim` rejects, the rejection's message doesn't contain `"AQEB"`, and 0 rows are written. Unstub.
  - **In `make-admin.int.test.ts`:**
    - Every existing `makeAdmin` call passes `keys`.
    - New: it writes one `staff.added` row, and that row verifies together with a following `audit()` row (one chain across the script and the app).
    - `makeAdmin` with keys whose `activeVersion` has no entry in `keys` (`{ activeVersion: "v2", keys: new Map() }`) rejects, and `staff_members`, `staff_roles` and `audit_log` are all empty afterwards.

- [ ] **Step 2: Run them to see them fail.** Run `vp test --project integration src/server/data/permissions.int.test.ts scripts/make-admin.int.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `make-admin-core.ts`, check that the active key is there before `begin`, and throw before any write. Replace its header comment: the scripts can't import the data layer, but they can import `chain.ts`, which has no imports (spec call 15).

- [ ] **Step 4: Run the tests to see them pass,** then `vp test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/data/ scripts/make-admin.ts scripts/make-admin-core.ts scripts/make-admin.int.test.ts
git commit -m "feat: audit claim.viewed, referral.viewed and staff.added"
```

---

### Task 7: `vp run db:check-app-role`

**Files:**
- Create: `scripts/check-app-role-core.ts`, `scripts/check-app-role.ts`, `scripts/check-app-role.int.test.ts`
- Modify: `package.json` (`"db:check-app-role": "node scripts/check-app-role.ts"`)

**Interfaces:**
- Consumes:
  - From Task 4: `verifyAuditChain` and `Queryable`, from `../src/server/audit/verify.ts`.
  - From Task 1: `parseKeys` and `AuditKeys`.
- Produces: `checkAppRole(client: Queryable, keys: AuditKeys): Promise<{ name: string; ok: boolean }[]>`. The checks, in this order:
  1. `connected as kerb_app`
  2. `no superuser, CREATEROLE, CREATEDB or BYPASSRLS`
  3. `not a member of neon_superuser or any pg_*_data role` (recursive: `pg_has_role(current_user, r.oid, 'MEMBER')` over `pg_roles`, matching `neon_superuser` or `^pg_.*_data$`)
  4. `UPDATE, DELETE and TRUNCATE on audit_log refused` (`has_table_privilege(current_user, 'audit_log', …)`)
  5. `audit_log triggers present` (`audit_log_append_only` and `audit_log_record_delete` in `pg_trigger`, with `tgenabled = 'O'`)
  6. `audit chain verifies`

  Check 4 uses the privilege functions, not real statements, so a misconfigured branch can never lose data to the check. Each check's `name` is fixed text. No check ever includes a value from the database apart from the verify `rowId` and `reason`.

- [ ] **Step 1: Write the failing tests** in `check-app-role.int.test.ts`:
  - As `kerb_app` (a `pg.Client` on `process.env.DATABASE_URL`), with two `audit()` rows written: every check is `ok: true`.
  - As the owner (`TEST_DATABASE_URL`, `postgres`): `connected as kerb_app`, the attributes check and the `audit_log` refusal check are `ok: false`.
  - After `tamper` of a row: `audit chain verifies` is `ok: false`.

- [ ] **Step 2: Run them to see them fail.** Run `vp test --project integration scripts/check-app-role.int.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`check-app-role-core.ts`:** the checks.
  - **`check-app-role.ts`:**
    - Loads `.env.local` (as `make-admin.ts` does).
    - Parses the keys. On `AuditKeyError`, it prints the same message as `make-admin` and exits 1.
    - Prints `Database: <host>` using `databaseHost()`, and never the URL.
    - Prints `PASS <name>` or `FAIL <name>` per check. For a failed verify, it also prints `(row <id>: <reason>)`.
    - Exits 1 if any check fails.

- [ ] **Step 4: Run the tests to see them pass,** then run the script against the test database: `DATABASE_URL=<test kerb_app url> AUDIT_HMAC_KEYS=… vp run db:check-app-role`. Expected: six `PASS` lines, with no URL or key in the output.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-app-role*.ts package.json
git commit -m "feat: db:check-app-role verifies a branch's app role and audit chain"
```

---

### Task 8: Docs and final verification

**Files:**
- Modify:
  - `plan/engineering.md`: §3, §7 lines 259–275, §9.
  - `plan/phases/04-data-auth/phase.md`: the 4.5b row (line 25), a new 4.5c row, and testing rows 57–58.
  - `plan/build-plan.md`: line 40, plus a new 4.5c line.
  - `plan/phases/04-data-auth/05b-audit-integrity.md`: status, ticked steps, and a `## Results` in the 4.5 style.

- [ ] **Step 1: Write the docs.**
  - **§3:** two roles. `DATABASE_URL` (pooled) is `kerb_app`. `DATABASE_URL_UNPOOLED` is the owner, used for migrations and the deploy. New tables get `kerb_app`'s grants by default, and `app-role.int.test.ts` lists every table.
  - **§7:**
    - Replace `sha256(prev_hash ‖ row)` with the HMAC, the canonical fields, `key_version` and rotation (add `vN`, make it active, keep the old ones listed).
    - Add the limitation (decision 6, with 4.11's anchor).
    - Add fail-closed (call 12).
    - Add "only successful views" (call 13).
    - Drop the "optional (8.9)" non-owner line, because it's done.
  - **§9:** keys and URLs are never logged, and audit failures are logged by name only.
  - **`phase.md`:** rewrite the 4.5b row to match this slice. Add 4.5c (`withTx`, `withIdempotency`, `limit()`, validation-error contract). Move the `withTx`/`withIdempotency`/`limit()` testing row to 4.5c.
  - **The spec's Results:** what changed from the spec. At least these three:
    - Arrays and objects allowed in `changes` (see Global Constraints).
    - `verifyAuditChain` takes a `Queryable` so the script can use it.
    - The check script uses privilege functions.

- [ ] **Step 2: Verify everything.** Run `vp check`, then `vp test`, then `vp build`. Expected: all pass, with the test counts recorded in Results.

- [ ] **Step 3: Commit**

```bash
git add plan/
git commit -m "docs: 4.5b results; engineering.md audit chain, app role and keys; 4.5c row"
```

---

## After the build (Damion, from spec "What you set up")

These are manual dashboard steps, done after the whole-branch review and before the PR merges to staging. Two notes the docs added:

- **Passwords:** Neon refuses a SQL-set password under 60 bits of entropy. `openssl rand -base64 24` is enough.
- **Pooling:** Neon's docs don't say whether a SQL-created role works through `-pooler`. Step 4 (`db:check-app-role` over the pooled `DATABASE_URL`) is what proves it on `dev`.
