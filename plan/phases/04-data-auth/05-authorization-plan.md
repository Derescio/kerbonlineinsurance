# 4.5 Authorization and data access: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permission-based authorization with multi-role staff, eight scoped reads (customer and staff), the conflict-of-interest rule, `auth:make-admin`, a `_staff` guard, and a permission suite that takes its expectations from the role map.

**Architecture:** Roles move into `staff_roles`. A code map (`ROLE_PERMISSIONS`) turns roles into permissions. Each request becomes an `Actor`, built from the session and the database. Every read in `src/server/data/` is declared with `defineRead(access, run)`, which checks access before `run` and exposes `access`, so the suite can read it. A lint rule keeps database imports inside the data, auth and db folders.

**Tech Stack:** TanStack Start 1.169 (`createServerFn`, `createMiddleware`), Better Auth 1.7.15, Drizzle 0.45 + node-postgres, drizzle-kit 0.31, zod 4, Vitest via `vite-plus/test` (projects `unit`, `integration`, `component`), Playwright e2e, oxlint via `vp check`.

**Spec:** [05-authorization.md](05-authorization.md) (approved 5 Nov 2026). Read it first; this plan only adds what the builder can't decide alone.

## Global Constraints

- Branch `slice/4.5-authorization` from `staging`; one commit per task (Conventional Commits); the PR into `staging` is squash-merged with the spec's commit message.
- Roles: `staffRoles = ["claims_handler", "admin"]` (unchanged). Permissions, exactly: `claims.read_all`, `claims.update`, `referrals.read`, `referrals.decide`, `reviews.moderate`, `staff.manage`, `audit.read`. Grants exactly as the spec's table.
- No function outside `src/server/auth/permissions.ts` names a role. Staff checks go through `requirePermission`. There is no `requireRole`.
- Someone else's record, a missing record and a malformed id all give `NOT_FOUND`. Staff functions without the permission give `FORBIDDEN`.
- Errors carry no stack trace or internal message to the browser. Logs carry ids, never emails or addresses.
- Staff codes match `^H-[0-9]{3}$`.
- Migrations: never hand-edit a generated file. Hand-written SQL goes in a `drizzle-kit generate --custom` migration. Every trigger function pins `search_path = public`.
- Test imports come from `vite-plus/test`. Integration tests call `truncateAll()` in `beforeEach` and `closeDb()` in `afterAll`, like `src/server/auth/auth.int.test.ts`.
- `vp check` and `vp test` pass at the end of every task. Integration tests need `vp run db:test:up`.

## Review Focus

1. **A staff member with no customer row.** The queue filter "not my own" must not become `customer_id <> NULL`, which hides every row. A handler with no customer row sees every claim and referral. The test is in Task 5.
2. **Malformed ids** (`""`, `"not-a-uuid"`, `"'; drop table claims;--"`, a valid UUID that doesn't exist) give `NOT_FOUND` from every lookup, never a 500 or a Postgres error. The test is in Task 4 and Task 5.
3. **A session whose user has been deleted, or a session that's expired,** gives a `null` actor (guest), never a crash or a stale actor. The test is in Task 3.
4. **`auth:make-admin` with different capitals** (`Maya@Example.COM`) finds the account stored as `maya@example.com`. The test is in Task 7.
5. **A referral that's already decided** (the item is `quoted` or `declined` again after a staff decision) leaves the queue, but `staffGetReferral` still opens it, because its history matters in 6.11. The test is in Task 5.

---

### Task 0: Branch and spec

- [ ] **Step 1:** `git switch staging && git pull --ff-only && git switch -c slice/4.5-authorization`. The approved spec edits and this plan are in the working tree.
- [ ] **Step 2: Commit**

```bash
git add plan/phases/04-data-auth/05-authorization.md plan/phases/04-data-auth/05-authorization-plan.md
git commit -m "docs: 4.5 spec and implementation plan"
```

---

### Task 1: `staff_roles` replaces `staff_members.role`

**Files:**
- Modify: `src/server/db/schema/staff.ts`, `src/server/db/schema/relations.ts`, `src/server/db/data-contract.ts`, `src/test/factories.ts`, `src/server/db/constraints.int.test.ts`
- Create: `drizzle/0006_*.sql` (generated), `drizzle/0007_staff_roles_data.sql` (custom), `drizzle/0008_*.sql` (generated)

**Interfaces:**
- Produces: table `staffRoles` (`userId: text`, `role: text`, `grantedAt: timestamptz`), PK `(user_id, role)`, exported from `#/server/db/schema`; relations `staffMembers.roles` (many) and `staffRoles.staffMember` (one); `makeStaff({ roles?: StaffRole[], ...staffMemberOverrides })` returning the `staff_members` row plus `roles: string[]` (default `["claims_handler"]`); `type StaffRole = (typeof staffRoles)[number]` exported from `values.ts`.

- [ ] **Step 1: Write the failing tests** in `constraints.int.test.ts`, `describe("staff (decision 18)")`. Replace `"refuses an unknown role"` with:

```ts
it("refuses an unknown role", async () => {
  const staff = await makeStaff({ roles: [] });
  await expectRefused(
    getDb().insert(staffRoles).values({ userId: staff.userId, role: "superuser" }),
    CHECK, "staff_roles_role_check");
});
it("refuses the same role twice", async () => {
  const staff = await makeStaff({ roles: ["admin"] });
  await expectRefused(
    getDb().insert(staffRoles).values({ userId: staff.userId, role: "admin" }),
    UNIQUE, "staff_roles_pkey");
});
it("refuses updating a role row (grant or remove, never edit)", async () => {
  const staff = await makeStaff({ roles: ["admin"] });
  await expectRefused(
    getDb().update(staffRoles).set({ role: "claims_handler" }).where(eq(staffRoles.userId, staff.userId)),
    APPEND_ONLY);
});
it("records a removed role for the pipeline", async () => {
  const staff = await makeStaff({ roles: ["admin", "claims_handler"] });
  await getDb().delete(staffRoles).where(and(eq(staffRoles.userId, staff.userId), eq(staffRoles.role, "admin")));
  const rows = await getDb().select().from(deletedRows).where(eq(deletedRows.tableName, "staff_roles"));
  expect(rows.map((r) => r.rowId)).toEqual([`${staff.userId}:admin`]);
});
```

- [ ] **Step 2:** Run `vp test --project integration src/server/db/constraints.int.test.ts`. Expected: FAIL, because `staffRoles` isn't exported.
- [ ] **Step 3: Add `staffRoles` to `staff.ts`. Keep `staff_members.role` for now.**
  - Columns: `userId` (FK `staffMembers.userId`, `onDelete: "cascade"`), `role` (`CHECK staff_roles_role_check` with `oneOf(t.role, staffRoles)`), `grantedAt` (`timestamptz`, not null, `defaultNow()`).
  - Primary key `(userId, role)`, plus an index on `role`.
  - Add the relations.
  - Run `vp run db:generate` → `0006_*.sql` (create table only). Review the SQL.
- [ ] **Step 4: `vp exec drizzle-kit generate --custom --name staff_roles_data` → `0007_staff_roles_data.sql`**, containing, in this order:
  - a header comment in the 0002 style
  - `INSERT INTO staff_roles (user_id, role, granted_at) SELECT user_id, role, started_at FROM staff_members;`
  - trigger `staff_roles_append_only` `BEFORE UPDATE … EXECUTE FUNCTION refuse_change()`
  - trigger `staff_roles_record_delete` `AFTER DELETE … EXECUTE FUNCTION record_delete('user_id', 'role')`
- [ ] **Step 5: Drop the column.** Remove `role`, its `CHECK` and its index from `staffMembers`, then run `vp run db:generate` → `0008_*.sql`. Check that it only drops the constraint, the index and the column.
- [ ] **Step 6: Data contract.**
  - Remove `"role"` from the `staff_members` keep list, and change its grain to `"one staff member"`.
  - Add `staff_roles`: grain `"one role held by a staff member"`, `primaryKey: ["user_id", "role"]`, `changeColumn: "granted_at"`, `kind: "append-only"`, `copied: true`, columns `keep("user_id", "role", "granted_at")`.
  - Add `StaffRole` to `values.ts`.
- [ ] **Step 7: Factories.** `makeStaff({ roles = ["claims_handler"], ...overrides })` inserts the `staff_members` row, then one `staff_roles` row per role, and returns `{ ...staff, roles }`. Update the other `makeStaff` callers in `constraints.int.test.ts` (`makeStaff({ role: … })` → `roles: [...]`).
- [ ] **Step 8: Add a migration test** in `constraints.int.test.ts`, named `"0007 copies existing roles into staff_roles"`. Use a raw `pg` client on `TEST_DATABASE_URL` to:
  1. `CREATE DATABASE kerb_migration_check`, dropping it first if it exists
  2. connect to it and apply `0000`–`0006` by reading each `drizzle/*.sql` file in journal order and running its statements, split on `--> statement-breakpoint`
  3. insert a user and a `staff_members` row with `role = 'admin'`
  4. apply `0007` and `0008` the same way
  5. assert `staff_roles` holds `(user_id, 'admin')` and `staff_members` has no `role` column
  6. drop the database in `finally`

  Use a separate database, not a schema, because the 0002 functions pin `search_path = public`.
- [ ] **Step 9:** Run `vp test --project integration` and `vp test --project unit` (`data-contract.test.ts`). Expected: PASS. The 4.2 trigger-coverage test must pass without changes.
- [ ] **Step 10:** `vp run db:check`. Expected: no drift.
- [ ] **Step 11: Commit** `feat: staff can hold several roles (staff_roles replaces staff_members.role)`

---

### Task 2: The permission map

**Files:**
- Create: `src/server/auth/permissions.ts`, `src/server/auth/permissions.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS` (readonly tuple of the seven)
  - `type Permission`
  - `ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>>`
  - `permissionsFor(roles: readonly string[]): ReadonlySet<Permission>`. Unknown role strings are ignored, so a role removed from the code but left in the database grants nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
it("pins who can do what", () => {
  expect(ROLE_PERMISSIONS).toMatchInlineSnapshot(); // filled on first run, then reviewed against the spec table
});
it("grants every permission to some role", () => {
  for (const p of PERMISSIONS) expect(Object.values(ROLE_PERMISSIONS).flat()).toContain(p);
});
it("has an entry for every role", () => {
  expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...staffRoles].sort());
});
it("unions several roles and ignores unknown ones", () => {
  expect(permissionsFor(["claims_handler", "retired_role"])).toEqual(new Set(ROLE_PERMISSIONS.claims_handler));
  expect(permissionsFor([])).toEqual(new Set());
});
```

- [ ] **Step 2:** Run `vp test --project unit src/server/auth/permissions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** List `admin`'s permissions out in full (spec decision 5), and add a comment saying so.
- [ ] **Step 4:** Run the tests. The snapshot gets written. Check it line by line against the spec's table before accepting it. Expected: PASS.
- [ ] **Step 5: Commit** `feat: role-to-permission map`

---

### Task 3: Errors and the actor

**Files:**
- Create: `src/server/auth/errors.ts`, `src/server/auth/errors.test.ts`, `src/server/auth/actor.ts`, `src/server/auth/actor.test.ts`, `src/server/auth/actor.int.test.ts`

**Interfaces:**
- Consumes: `permissionsFor`, `Permission` (Task 2); `staffRoles` table (Task 1).
- Produces:
  - `class AuthzError extends Error { code: AuthzCode; status: 401 | 403 | 404 }`, with `type AuthzCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT_OF_INTEREST"`
  - `toPublicError(error: unknown): { status: number; code: AuthzCode | "INTERNAL"; message: string }`
  - `interface Actor { userId: string; customerId: string | null; staff: { displayName: string; roles: readonly string[]; permissions: ReadonlySet<Permission> } | null }`
  - `resolveActor(db: Db, userId: string): Promise<Actor | null>` (null if the user doesn't exist)
  - `getActor(headers: Headers): Promise<Actor | null>`
  - `requireUser(actor: Actor | null): Actor`
  - `requirePermission(actor: Actor | null, permission: Permission): Actor`
  - `assertNoConflict(actor: Actor, ownerCustomerId: string): void`

- [ ] **Step 1: Failing unit tests** (`errors.test.ts`, `actor.test.ts`, with pure `Actor` literals).
  - `toPublicError` messages, copied exactly:
    - `UNAUTHENTICATED` 401: "Please log in to continue."
    - `FORBIDDEN` 403: "You don't have access to this."
    - `NOT_FOUND` 404: "We couldn't find that."
    - `CONFLICT_OF_INTEREST` 403: "You can't work on your own policy, claim or quote. Ask a colleague."
    - anything else, 500 `INTERNAL`: "Something went wrong. Please try again."
  - The result never contains the original `message` or `stack` (assert on a thrown `new Error("select * from users")`).
  - `requireUser(null)` throws `UNAUTHENTICATED`.
  - `requirePermission`:
    - `null` → `UNAUTHENTICATED`
    - a customer → `FORBIDDEN`
    - staff with no roles → `FORBIDDEN`
    - a handler with `claims.read_all` → returns the actor
    - a handler with `staff.manage` → `FORBIDDEN`
  - `assertNoConflict`: throws `CONFLICT_OF_INTEREST` when `actor.customerId === owner`; doesn't throw when they differ or when `actor.customerId` is null.
- [ ] **Step 2:** Run the unit tests. Expected: FAIL.
- [ ] **Step 3: Implement `errors.ts` and the pure parts of `actor.ts`.**
- [ ] **Step 4: Failing integration tests** (`actor.int.test.ts`, `resolveActor`):
  - a plain user → `{ customerId: null, staff: null }`
  - a user with a customer row → `customerId` set
  - a handler → `staff.roles` is `["claims_handler"]` and its permissions match the map
  - two roles → the union
  - `deactivatedAt` in the past → `staff: null`
  - after deleting one of two `staff_roles` rows, a fresh `resolveActor` loses that role's permissions
  - every role removed → `staff` is set with empty `roles` and `permissions`
  - an unknown user id → `null`
  - (Review Focus 3) a deleted user → `null`
- [ ] **Step 5: Implement `resolveActor`.** Use one query: the user left-joined to `customers` and `staff_members` (where `deactivated_at is null`), plus that member's `staff_roles`. Use the relational query (`db.query.users.findFirst({ with: … })`), or two small queries. No N+1.
- [ ] **Step 6: Implement `getActor(headers)`.** Call `getAuth().api.getSession({ headers, query: { disableCookieCache: true } })`, then `resolveActor(getDb(), session.user.id)`. No session gives `null`. Expired sessions are handled by Better Auth. Add no test beyond Task 8's e2e, since it's three lines of glue.
- [ ] **Step 7:** Run the unit and integration tests. Expected: PASS.
- [ ] **Step 8: Commit** `feat: Actor, requireUser, requirePermission and the conflict-of-interest check`

---

### Task 4: `defineRead`, the suite harness and the customer reads

**Files:**
- Create: `src/server/data/define.ts`, `src/server/data/policies.ts`, `src/server/data/claims.ts`, `src/server/data/index.ts`, `src/server/data/permissions.int.test.ts`, `src/test/world.ts` (test-only)

**Interfaces:**
- Consumes: `Actor`, `requireUser`, `requirePermission`, `AuthzError` (Task 3); `makeStaff({ roles })` (Task 1).
- Produces:
  - `type Access = "signed_in" | Permission`
  - `defineRead<I, O>(access: Access, input: z.ZodType<I>, run: (actor: Actor, input: I, db: Db) => Promise<O>): DataRead<I, O>`
  - `interface DataRead<I, O> { (actor: Actor | null, input: I): Promise<O>; access: Access }`
  - It checks access first (`requireUser` or `requirePermission`), then parses `input`, turning any zod failure into `NOT_FOUND`, then calls `run(actor, parsed, getDb())`.
  - Ids are `z.uuid()`.
  - Inputs:
    - `listMyPolicies(actor, {})` → `PolicySummary[]`
    - `getMyPolicy(actor, { policyId })` → `PolicyDetail`
    - `listMyClaims(actor, {})` → `ClaimSummary[]`
    - `getMyClaim(actor, { claimId })` → `CustomerClaimDetail`
  - Types, in `policies.ts` and `claims.ts`:
    - `PolicySummary { id, reference, product, coverLevel, status, startsOn, endsOn }`
    - `PolicyDetail = PolicySummary & { annualPremiumPence, compulsoryExcessPence, voluntaryExcessPence, autoRenew, claims: ClaimSummary[] }`
    - `ClaimSummary { id, reference, policyId, status, incidentType, incidentAt, submittedAt, createdAt }`
    - `ClaimEventView { id, type, fromStatus, toStatus, note, createdAt }`
    - `CustomerClaimDetail = ClaimSummary & { incidentLocation, description, otherVehicleInvolved, rearEnded, injuries, policeAttended, policeReference, claimedAmountPence, version, events: ClaimEventView[] }`
  - `index.ts` re-exports every read. The suite iterates its exports.
  - `src/test/world.ts` exports `buildWorld()`, which returns `{ guest: null, customerA, customerB, handler, admin, deactivatedHandler, adminCustomer, rolelessStaff, handlerNoCustomer }` (each an `Actor | null` via `resolveActor`), plus the records: A's policy, claim (with one `customer` and one `internal` event) and referral; B's policy and claim; `adminCustomer`'s own claim and referral.

- [ ] **Step 1: Write the suite harness and the customer rows, failing.** `permissions.int.test.ts` builds the world in `beforeEach`. Its table, `const cases: Case[]`, has one entry per read, `{ read, input(world), owner: "A" | "admin" | null }`. Generated tests:
  - **Access from the map:** for each read and each actor:
    - guest → `UNAUTHENTICATED`
    - for `access === "signed_in"`, every signed-in actor passes the access check
    - for a permission, `allowed = actor?.staff?.permissions.has(read.access)`; allowed actors don't get `FORBIDDEN`, others get `FORBIDDEN`
  - **Cross-user:**
    - `getMyPolicy(customerB, { policyId: A's })` → `NOT_FOUND`
    - `getMyClaim(customerB, { claimId: A's })` → `NOT_FOUND`
    - `listMyPolicies(customerB)` and `listMyClaims(customerB)` contain none of A's ids
  - **Own:**
    - `getMyPolicy(customerA)` returns the policy with its claim
    - `listMyClaims(customerA)` includes the draft
  - **No customer row:** `listMyPolicies(handlerNoCustomer)` → `[]`, and `getMyClaim(handlerNoCustomer, A's)` → `NOT_FOUND`
  - **Internal notes:** `getMyClaim(customerA)` has the `customer` event and not the `internal` one
  - **Review Focus 2:** each of `""`, `"not-a-uuid"`, `"'; drop table claims;--"` and `randomUUID()` → `NOT_FOUND` from `getMyPolicy` and `getMyClaim`
  - **Completeness:** every export of `#/server/data` has a string `access` and appears in `cases`, failing with the export's name
- [ ] **Step 2:** Run `vp test --project integration src/server/data/permissions.int.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement `define.ts`.**
- [ ] **Step 4: Implement the four customer reads.**
  - Each filters by `actor.customerId`. If it's null, return `[]` or throw `NOT_FOUND` before querying.
  - Lists are ordered `created_at desc`.
  - `getMyPolicy` loads its claims through the relational query.
  - `getMyClaim` loads events where `visibility = 'customer'`, ordered `created_at asc`.
- [ ] **Step 5:** Run the suite. Expected: PASS.
- [ ] **Step 6: Commit** `feat: scoped customer reads and the permission suite`

---

### Task 5: Staff reads and referrals

**Files:**
- Create: `src/server/data/referrals.ts`
- Modify: `src/server/data/claims.ts`, `src/server/data/index.ts`, `src/test/world.ts`, `src/server/data/permissions.int.test.ts`, `src/test/factories.ts`

**Interfaces:**
- Consumes: `defineRead`, `assertNoConflict`, the world (Task 4).
- Produces:
  - `makeReferral({ customerId? })`: a `makeQuote` car item updated to `outcome = 'referred'`, `reasonCode = 'high_value_vehicle'`, plus an automatic `underwriting_decisions` row (`outcome 'referred'`, `decidedBy null`). Returns `{ quote, item }`.
  - `staffListClaims(actor, { status?: ClaimStatus; limit?: number /* 1–100, default 50 */; offset?: number })` → `StaffClaimSummary[]`, where `StaffClaimSummary = ClaimSummary & { customerId, assignedHandlerId }`
  - `staffGetClaim(actor, { claimId })` → `StaffClaimDetail = CustomerClaimDetail & { customerId, assignedHandlerId, events: (ClaimEventView & { visibility, actorUserId })[] }`
  - `staffListReferrals(actor, { limit?, offset? })` → `ReferralSummary[]`, where `ReferralSummary { quoteItemId, quoteId, quoteReference, product, reasonCode, createdAt }`
  - `staffGetReferral(actor, { quoteItemId })` → `ReferralDetail = ReferralSummary & { outcome, startDate, quote: { postcodeDistrict, totalPence, validUntil }, decisions: { id, outcome, reasonCode, loadingPercent, decidedBy, note, createdAt }[] }`
  - Access: claims reads → `"claims.read_all"`, referral reads → `"referrals.read"`.

- [ ] **Step 1: Failing tests** (add the cases to the table, plus):
  - `staffGetClaim(handler, A's claim)` includes the `internal` event
  - `staffGetClaim(adminCustomer, own claim)` and `staffGetReferral(adminCustomer, own referral)` → `CONFLICT_OF_INTEREST`
  - `staffListClaims(adminCustomer)` and `staffListReferrals(adminCustomer)` leave out their own records but include A's
  - `staffListClaims(handler, { status: "draft" })` returns only drafts
  - **Review Focus 1:** `staffListClaims(handlerNoCustomer)` and `staffListReferrals(handlerNoCustomer)` include A's and `adminCustomer`'s records
  - **Review Focus 5:** after setting A's referred item to `quoted` and inserting a staff decision, it's gone from `staffListReferrals` and `staffGetReferral` still returns it with both decisions
  - `staffGetReferral` on an item that was never referred → `NOT_FOUND`
  - malformed ids → `NOT_FOUND` (as Task 4)
  - `limit: 0` or `101` → `NOT_FOUND`, the same as any invalid input
- [ ] **Step 2:** Run the suite. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Own-record exclusion:** `actor.customerId === null ? undefined : ne(claims.customerId, actor.customerId)`, and the same on `quotes.customer_id` for referrals.
  - **What counts as a referral:** `outcome = 'referred'`, or any `underwriting_decisions` row with `outcome = 'referred'` (an `exists` subquery). The queue lists only `outcome = 'referred'`.
  - **Conflict check:** call `assertNoConflict(actor, row.customerId)` after loading the row. A missing row is `NOT_FOUND` first.
- [ ] **Step 4:** Run the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: staff reads for claims and referrals with the conflict-of-interest rule`

---

### Task 6: Only the data layer touches the database

**Files:**
- Modify: `vite.config.ts` (`lint`), `src/routes/api/auth/$.ts`, `src/server/auth/handler.ts`

**Interfaces:**
- Produces: `handleAuthRoute(request: Request): Promise<Response>` in `handler.ts`. It holds the `getDb()` and `recordSecurityEvent` call currently in `$.ts`, so the route imports nothing from `#/server/db`.

- [ ] **Step 1: Add `no-restricted-imports` as an error in `lint.rules`.**
  - **Paths:** `#/server/db/client` with the message "Query through a function in src/server/data/ (4.5)".
  - **Patterns:**
    - `#/server/db/schema`, `#/server/db/schema/*` and the relative forms `**/db/client` and `**/db/schema*`, with the same message
    - `#/server/auth/permissions` with `importNames: ["ROLE_PERMISSIONS"]` and the message "Check a permission with requirePermission, never a role"
  - Add an `overrides` entry that turns the rule off for `src/server/data/**`, `src/server/auth/**`, `src/server/db/**`, `src/test/**`, `scripts/**` and `**/*.int.test.ts`. If vite-plus's `lint` key doesn't pass `overrides` through to oxlint, use an `.oxlintrc.json` and say so in the commit message.
- [ ] **Step 2:** Run `vp check`. Expected: FAIL on `src/routes/api/auth/$.ts`.
- [ ] **Step 3: Move the handler.** Put the route's body into `handleAuthRoute` and have `$.ts` call it.
- [ ] **Step 4: One-off check of the rule.**
  1. Add `import { getDb } from "#/server/db/client";` to `src/features/auth/session.ts`.
  2. Run `vp check`. Expected: the custom message.
  3. Add `import { ROLE_PERMISSIONS } from "#/server/auth/permissions";` there too. Expected: an error.
  4. Revert both.
  5. Run `vp check`. Expected: PASS.

  Put both checks in the commit body.
- [ ] **Step 5:** Run `vp test`. Expected: PASS (the auth tests are unchanged).
- [ ] **Step 6: Commit** `feat: lint rule keeping database access in the data layer`

---

### Task 7: `auth:make-admin`

**Files:**
- Create: `scripts/make-admin-core.ts`, `scripts/make-admin.ts`, `scripts/make-admin.int.test.ts`
- Modify: `package.json` (script `"auth:make-admin": "node scripts/make-admin.ts"`), `vite.config.ts` (integration `include` gains `"scripts/**/*.int.test.ts"`, and unit `exclude` gains the same)

**Interfaces:**
- Produces:
  - `makeAdmin(client: pg.ClientBase, email: string, displayName: string): Promise<{ userId: string; staffCode: string }>`
  - It throws `MakeAdminError` with `reason: "no_user" | "unverified" | "already_staff" | "bad_name"`.
  - It uses raw SQL through `pg`, so it runs under plain `node` like `db-deploy.ts`, because `src/` imports have no extensions.

- [ ] **Step 1: Failing tests.** Each test uses a `pg.Client` on `DATABASE_URL` and the factories for users.
  - makes `H-001` for the first staff member, then `H-002` when an `H-001` exists
  - writes `staff_members` (`display_name` as given) and a `staff_roles` row for `admin`
  - an unknown email → `no_user`
  - `emailVerified: false` → `unverified`
  - an existing staff member → `already_staff`, and their roles are unchanged
  - an empty or whitespace-only name → `bad_name`
  - **Review Focus 4:** `"  Maya@Example.COM "` finds `maya@example.com`
  - if the role insert fails, no `staff_members` row is left (one transaction)
- [ ] **Step 2:** Run `vp test --project integration scripts/make-admin.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `makeAdmin`.**
  - Trim and lowercase the email, and trim the name.
  - Run in one `BEGIN … COMMIT`.
  - Next code: `select coalesce(max(substring(staff_code from 3)::int), 0) + 1`, formatted `H-%03d`. The unique constraint catches a race.
- [ ] **Step 4: Implement `make-admin.ts`.**
  - Parse `<email> --name "<display name>"` with `node:util` `parseArgs`.
  - Require `DATABASE_URL`.
  - Print the database host (`new URL(...).host`), never the full URL.
  - On success, print `"<email> is now an admin (H-00n)"`. On failure, print one line per reason and exit 1.
- [ ] **Step 5:** Run the tests. Expected: PASS. Then check by hand against the Docker database: `DATABASE_URL=postgres://postgres:postgres@localhost:5433/kerb_test vp run auth:make-admin nobody@example.com --name Test` prints the `no_user` line and exits 1.
- [ ] **Step 6: Commit** `feat: auth:make-admin script`

---

### Task 8: Middleware and the `_staff` guard

**Files:**
- Create: `src/server/auth/middleware.ts`, `src/features/staff/access.ts`, `src/features/staff/access.int.test.ts`, `src/routes/_staff.tsx`, `src/routes/_staff/staff.tsx`
- Modify: `e2e/auth.spec.ts`, `src/routes/account.tsx` (comment only), `src/features/auth/session.ts` (comment only), `src/routeTree.gen.ts` (generated)

**Interfaces:**
- Consumes: `getActor`, `requireUser`, `requirePermission`, `resolveActor` (Task 3).
- Produces:
  - `userMiddleware` and `permissionMiddleware(permission: Permission)`, both `createMiddleware({ type: "function" }).server(...)`, each putting `actor: Actor` on `context`
  - `staffAccessFor(actor: Actor | null): "guest" | "customer" | "staff"` (pure)
  - `getStaffAccess`: a `createServerFn({ method: "GET" })` returning `staffAccessFor(await getActor(getRequestHeaders()))`

- [ ] **Step 1: Failing tests.**
  - `access.int.test.ts`, through `staffAccessFor(await resolveActor(...))`:
    - `null` → `guest`
    - customer → `customer`
    - deactivated handler → `customer`
    - staff with no roles → `customer`, because they hold no permission
    - handler → `staff`
  - `e2e/auth.spec.ts`: `test("the staff area sends a signed-out visitor to log in")` with `page.goto("/staff")`, expecting the URL `/\/login\?redirect=%2Fstaff$/`.
- [ ] **Step 2:** Run the integration test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `staffAccessFor` returns `"staff"` only when `actor.staff.permissions.size > 0`.
  - The `_staff` layout:
    - `headers` is `Cache-Control: private, no-store`
    - `beforeLoad` calls `getStaffAccess()`: `guest` → `redirect({ to: "/login", search: { redirect: location.href } })`, `customer` → `redirect({ to: "/account" })`
    - add a comment that this is UX only and 4.6 adds the 2FA gate here
  - `/staff` page: title "Staff area · Kerb". Body: "The staff area opens in 6.10." Use the existing `AuthShell` or a plain container, whichever the codebase already uses for placeholders.
  - Middleware: no callers yet. Add a doc comment showing `.middleware([permissionMiddleware("claims.update")])`.
  - Comments in `account.tsx` and `session.ts`: replace "4.5 adds requireUser()" with a pointer to `src/server/data/` and `getActor`.
- [ ] **Step 4:** Run `vp test` and `vp build`. Expected: PASS. Then run locally (`vp dev` against Docker, or `vp preview`): `/staff` signed out → `/login?redirect=%2Fstaff`. Sign in as a confirmed local customer (confirm through the Docker database), and `/staff` → `/account`.
- [ ] **Step 5: Commit** `feat: staff area guard and server middleware`

---

### Task 9: Docs, final checks, hand-off

**Files:**
- Modify: `plan/engineering.md` §7, `plan/phases/04-data-auth/02-schema.md`, `plan/phases/04-data-auth/phase.md`, `plan/build-plan.md`, `plan/phases/04-data-auth/05-authorization.md`

- [ ] **Step 1: Docs.**
  - **§7:**
    - add a "Permissions" table, copied from the spec
    - change "Where roles live" to `staff_members` + `staff_roles`
    - Enforcement layer 1 uses `requirePermission`
    - add a line on `NOT_FOUND` for other people's records and the lint rule
  - **02-schema.md:** add a note under decision 18: "4.5 moved roles into `staff_roles` (several per person)."
  - **phase.md:**
    - the 4.5 row links the spec and is marked done
    - a new **4.5b** row: audit chain (HMAC), `audit()`, `verifyAuditChain()`, record-view events, the non-owner app role and owner connection string, `withTx`, `withIdempotency`, `limit()`, and their tests
    - the 4.11 row gains "anchor the audit chain's latest hash in R2 daily (4.5 decision 4)"
    - the phase Testing table rows for 4.5 are split between 4.5 and 4.5b
  - **build-plan.md:** rewrite the 4.5 line and add 4.5b.
  - **The spec:** Status, ticked Steps, and a "Results" section with any changes from the spec, in the 4.4b format.
- [ ] **Step 2: Full verification.** `vp check`, `vp test` (all three projects) and `vp build`. Expected: all pass. Record the test count.
- [ ] **Step 3: Commit** `docs: 4.5 done, 4.5b and the audit anchor recorded`
- [ ] **Step 4: Push and open the PR** into `staging` (git-workflow.md step 2), titled with the spec's commit message.
- [ ] **Step 5: Hand-off to Damion** (not done by the agent):
  1. `vp run db:migrate` on Neon `dev`.
  2. `vp run auth:make-admin <your email> --name "<name>"` against `dev`.
  3. Check the `staff_members` and `staff_roles` rows in the Neon console.

  Staging applies `0006`–`0008` in its build.
