# 4.5 Authorization and data access

**Status:** approved 5 Nov 2026, not started
**Phase:** 04-data-auth

## Goal

Every protected read goes through one layer that knows who is asking, what their permissions allow, and which records are theirs. Customer B can't see customer A's policy or claim by guessing an id, a deactivated handler can't see anything, and an admin can't open their own claim or referral as staff. A permission suite proves it, and every later slice adds its functions to that suite.

Access is granted by **permission**, not by role name, and a staff member can hold **several roles**. A future role (underwriter, compliance, marketing) is a new entry in one file, with no change to any function.

The audit chain, the non-owner app role, `withTx`, `withIdempotency` and `limit()` follow in **4.5b**.

## Decisions (agreed 5 Nov 2026)

1. **Split into 4.5 and 4.5b** (Damion). 4.5 covers authorization and data access. 4.5b covers the audit chain and the write infrastructure. Both reach `main` in the Phase 4 release, as 4.4 and 4.4b did.
2. **Record-view audit events move to 4.5b** (agreed). They're written by `audit()`, and 4.2's schema requires every `audit_log` row to carry a hash, so they can't come before the chain. The staff read functions are built here without them. No staff screen uses them until 6.10, and 4.5b lands before the release, so production never has an unaudited staff read.
3. **Real data functions now** (Damion: "close those gaps"). Instead of a toolkit with nothing to protect, 4.5 writes the first scoped reads on the tables 4.2 built: policies, claims and referrals, for customers and for staff. Later slices (6.1, 6.6, 6.10, 6.11) put their pages on these functions and extend them, rather than writing their own queries.
4. **External anchoring of the audit chain goes to 4.11** (agreed). It's a daily Cron job that writes the latest hash to R2. It is recorded in the 4.11 row. 4.5b's HMAC resolves 4.2's "keyed hash or external anchor" either/or, and anchoring is added on top of it.
5. **Permissions, not role names** (Damion: "makes the app more robust"). Functions ask for a named permission (`requirePermission(actor, 'referrals.read')`) and never name a role. One file maps roles to permissions. Adding a role later is a `CHECK` migration and one map entry.
6. **The map lives in code, not in a table** (agreed). A permission change goes through a PR, review and the suite, and git records who changed what and when. A table that can be edited at runtime would be something an attacker could aim at, and it would need its own admin screens.
7. **Several roles per staff member** (agreed). Roles move from `staff_members.role` into a new `staff_roles` table, so someone can be, say, compliance and underwriter at once. A person's permissions are the union of their roles' permissions. Doing it now is cheap, because no real staff rows exist yet.
8. **No departments yet** (agreed). A role implies its department. A department only earns its place when the same role needs different access depending on department (for example, motor claims handlers seeing only motor claims). That's a scoping rule, and it would go in the data functions, where scoping already lives.

## Calls I've made (check these)

9. **Someone else's record is "not found", not "forbidden".** Customer B asking for customer A's policy gets the same `NOT_FOUND` as an id that doesn't exist, so ids can't be probed. Staff functions answer `FORBIDDEN` to anyone without the permission, because that reveals nothing about any record.
10. **The conflict-of-interest rule covers staff reads too, not only actions.** If a handler can't act on their own claim, opening it as staff does no good, and it's the read that 4.5b will audit. Staff queues (`staffListClaims`, `staffListReferrals`) leave out the staff member's own records, and opening one directly is refused with `CONFLICT_OF_INTEREST`. As a customer, the same person still sees their own records through the customer functions.
11. **Only the data layer may query the database.** A lint rule (oxlint `no-restricted-imports`) stops `getDb` and `#/server/db/schema` being imported outside `src/server/data/`, `src/server/auth/`, `src/server/db/`, `scripts/` and tests. A page or server function that wants data has to go through a scoped function. This is how "one place the rules live" (§7) is enforced, not just hoped for.
12. **Data functions are plain server modules, not server functions yet.** They take an `Actor` (below) and are called from inside server functions. In 4.5 nothing exposes them over the network. Their `createServerFn` wrappers arrive with the pages that use them, so the app gains no unused endpoints.
13. **The staff checks will include 2FA and a fresh session, but from 4.6.** In 4.5, `requirePermission` checks the active staff row and its roles only. 4.6 adds the other two checks inside the same function, so no caller changes.
14. **Staff can be customers.** A staff member who holds a policy sees it through the customer functions, like anyone else. §7's table shows "—" for handlers, which I read as "the role grants nothing here", not "a handler can't hold a policy".
15. **Only the permissions something will use are defined.** Each permission has a planned consumer, so there are no unused grants. Read permissions are used from 4.5. The others are defined now so the map is reviewed once, and their functions come with their slices.

## In scope

### Roles and permissions (`src/server/auth/permissions.ts`)

| Permission | What it allows | First used | `claims_handler` | `admin` |
|---|---|---|---|---|
| `claims.read_all` | see every claim (except your own) with internal notes | 4.5 | ✓ | ✓ |
| `claims.update` | change status, add notes and events, settle | 6.10 | ✓ | ✓ |
| `referrals.read` | see referred quotes (except your own) | 4.5 | ✓ | ✓ |
| `referrals.decide` | approve, load or decline a referral | 6.11 | ✓ | ✓ |
| `reviews.moderate` | approve or reject reviews | 6.8 | | ✓ |
| `staff.manage` | add staff, grant and remove roles, deactivate | 6.8 | | ✓ |
| `audit.read` | the audit viewer and "Verify chain" | 6.8 | | ✓ |

- `ROLE_PERMISSIONS` is a typed constant. The `Permission` and `StaffRole` types come from it, so a misspelled permission is a type error.
- `admin` is listed in full rather than as "everything", so a permission added later is never granted to admins without anyone choosing that.
- What a future role would look like, for the record only and not built: `underwriter` gets the two `referrals.*` permissions, `compliance` gets `claims.read_all`, `referrals.read` and `audit.read`, and `marketing` gets `reviews.moderate`.

### Schema (`0006_staff_roles`)

- **New `staff_roles`:** `user_id` (foreign key to `staff_members`, `CASCADE`), `role` (`CHECK` in `staffRoles`), `granted_at` (default `now()`), primary key `(user_id, role)`. Index on `role`.
- **`staff_members.role` is dropped**, together with its `CHECK` and index. The migration first copies any existing rows into `staff_roles`, so Neon `dev` and staging keep any staff they have.
- **`staff_members` keeps** `display_name`, `staff_code`, `started_at` and `deactivated_at`. Deactivation stays per person: a deactivated member has no permissions, whatever their roles.
- **A staff member with no roles** is allowed by the schema (6.8 may remove the last one) and has no permissions.
- **Data contract:** `staff_roles` is copied, `mutable`, with a `record_delete` trigger (a role removed in 6.8 is a delete the pipeline needs to see), and `user_id` and `role` kept. `role` comes off the `staff_members` entry. The 4.2 tests (every user-id column `keep`, the triggers matching the contract) cover it unchanged.
- **Factories:** `makeStaff({ roles: ['claims_handler'] })` replaces `makeStaff({ role })`. The 4.2 constraint test for a bad role moves to `staff_roles`.
- 4.2's rule still holds: `staff_members` and `staff_roles` together are the only place a role lives, and a user with no `staff_members` row is a customer.

### Who is asking (`src/server/auth/actor.ts`, `src/server/auth/middleware.ts`)

- **`Actor`**: `{ userId, customerId | null, staff: { displayName, roles, permissions } | null }`. It's built once per request from the session, read from the database rather than the cookie cache (as `getAccountSummary` already does), so a deactivation or a removed role takes effect on the next request.
  - `customerId` comes from `customers.user_id`. It's null until the first saved quote (5.6).
  - `staff` is set only for a `staff_members` row with no `deactivated_at`. `permissions` is the union of the roles' permissions. A deactivated member is treated as a customer from then on.
- **`requireUser(headers)`** returns the `Actor`, or throws `UNAUTHENTICATED` (401) with no session.
- **`requirePermission(actor, permission)`** throws `FORBIDDEN` (403) unless the actor is active staff holding that permission. There is no `requireRole`. Nothing outside `permissions.ts` checks a role name, and the lint rule from call 11 also bans importing `ROLE_PERMISSIONS` elsewhere.
- **`assertNoConflict(actor, ownerCustomerId)`** throws `CONFLICT_OF_INTEREST` (403) when the record's customer is the actor's own customer row.
- **TanStack Start middleware** (`userMiddleware`, `permissionMiddleware(permission)`) wraps these, so a server function declares `.middleware([permissionMiddleware('claims.update')])` and receives `context.actor`.
- **Errors:** one `AuthzError` with a `code` (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT_OF_INTEREST`) and an HTTP status. A shared mapper turns it into a friendly message, and stack traces never reach the browser (§9).
- **Impersonation stays off.** Nothing in the code switches identity, and no Better Auth admin plugin is installed.

### Scoped data (`src/server/data/`)

Customer functions take the `Actor`, never an owner id from input, and always filter by `actor.customerId`. With no customer row, lists come back empty and lookups come back `NOT_FOUND`.

| Function | Returns | Needs |
|---|---|---|
| `listMyPolicies(actor)` | the customer's policies, newest first, with product and status | signed in (call 14) |
| `getMyPolicy(actor, policyId)` | one policy and its claims (one query, through `relations.ts`) | signed in; `NOT_FOUND` if not theirs |
| `listMyClaims(actor)` | the customer's claims, newest first, drafts included | signed in |
| `getMyClaim(actor, claimId)` | one claim and its customer-visible `claim_events` only (`visibility = 'customer'`) | signed in; `NOT_FOUND` if not theirs |
| `staffListClaims(actor, { status? })` | every claim except the actor's own, filterable by status, newest first, paged | `claims.read_all` |
| `staffGetClaim(actor, claimId)` | one claim with **all** its events, internal ones included | `claims.read_all`; `CONFLICT_OF_INTEREST` on their own |
| `staffListReferrals(actor)` | quote items with `outcome = 'referred'` and no decision yet, except the actor's own | `referrals.read` |
| `staffGetReferral(actor, quoteItemId)` | one referred item with its quote and its `underwriting_decisions` | `referrals.read`; `CONFLICT_OF_INTEREST` on their own |

- Each function declares the permission it needs as data (`export const staffGetClaim = protectedRead('claims.read_all', ...)`, or similar), so the suite can read it rather than repeat it.
- Ids are validated as UUIDs with zod before any query. A malformed id is `NOT_FOUND`, not a database error.
- Returned shapes carry what the planned screens need and nothing more: no `user_id`, no other customer's details. Each later slice widens its function when its screen needs more.
- 4.5b adds `audit('claim.viewed' | 'referral.viewed')` to `staffGetClaim` and `staffGetReferral` (decision 2).

### First admin (`scripts/make-admin.ts`, `vp run auth:make-admin <email> --name "<display name>"`)

- Finds the user by email and refuses if there's no such user or their email isn't verified.
- In one transaction, inserts `staff_members` (the display name and the next free staff code: `H-001`, `H-002`, …) and a `staff_roles` row for `admin`.
- Refuses if the user is already staff, and doesn't change their roles (that's 6.8's job).
- Uses whatever `DATABASE_URL` it's run with. For production you run it locally with the `prod` connection string, never from the UI or the build.
- 4.5b adds its `audit_log` row (`staff.added`, actor null, meaning the system).

### Route guards (UX only)

- `/account` keeps its session check (found while planning: the page shows the session's own name, email and sign-in methods, not a scoped query, so `requireUser` would add a second lookup for nothing). Its comments point at the 4.5 layer for anything it loads later.
- A `_staff` layout route is added with a guard (`getStaffAccess()`, a server function returning `guest`, `customer` or `staff`) that sends guests to `/login` and anyone who isn't active staff to `/account`. It holds one placeholder page, `/staff` ("The staff area opens in 6.10."), so the guard can be tested end to end. 6.8, 6.10 and 6.11 add the real pages, each guarding on its own permission, and 4.6 adds the 2FA gate.
- The server stays the security boundary. Every guard has a matching server check, and the permission suite never relies on a guard.

### Permission suite (`src/server/data/permissions.int.test.ts`)

- **Actors:** guest, customer A, customer B, claims handler, admin, deactivated handler, an admin who is also a customer, and a staff member with **no roles**. Each actor is built with the 4.2 factories (`makeUser`, `makeCustomer`, `makeStaff`, `makePolicy`, `makeClaim`, plus a referred quote item).
- **The expected result of each cell comes from the map**, not from a hand-written list. A staff function's expected result for an actor is "allowed" exactly when one of the actor's roles grants the function's permission. The suite stays right when a role is added, and a role added to the map without thought shows up as new passing cells in review.
- **Cross-user rows:** B asks for A's policy and claim by id and gets `NOT_FOUND`. `listMyPolicies` and `listMyClaims` for B never contain A's rows.
- **Staff rows:** a handler sees A's claim; a deactivated handler and a staff member with no roles are `FORBIDDEN`; an admin who holds a policy is refused their own claim and their own referral and doesn't see them in the queues; a customer calling a `staff*` function is `FORBIDDEN`.
- **Several roles:** a member holding two roles gets the union, and removing one role (deleting its `staff_roles` row) removes those permissions on the next request.
- **Internal notes:** `getMyClaim` never returns an `internal` event, and `staffGetClaim` does.
- **Completeness:** the test fails if a function exported from `src/server/data/` has no declared permission (or `signed in`), so a later slice can't add a function and forget its rule.

### The map, pinned (`src/server/auth/permissions.test.ts`)

- An inline snapshot of `ROLE_PERMISSIONS`. Any change to who can do what changes the snapshot, so it's visible in the PR diff and has to be accepted on purpose.
- Every permission is granted to at least one role, and every role in `staffRoles` has an entry.

## Out of scope

- **4.5b:** `audit()`, the HMAC chain, `verifyAuditChain()`, record-view events, the non-owner Postgres app role and the second (owner) connection string for migrations, `withTx`, `withIdempotency`, `limit()`, and their tests.
- **4.6:** 2FA and fresh-session checks inside `requirePermission`, and the 2FA gate on `_staff`.
- **4.11:** anchoring the chain's latest hash in R2 on a schedule (decision 4).
- **6.8:** granting and removing roles and deactivating staff through the UI.
- **New roles** (underwriter, compliance, marketing) and departments (decision 8). The design makes them a small change, and none is built until a slice needs one.
- Any write function (claim status, referral decisions). They need `withTx` and `audit()` (4.5b) and come with their screens (6.10, 6.11), and they use `requirePermission` and `assertNoConflict` from here.

## Steps

- [x] You approve this spec (5 Nov 2026)
- [ ] `0006_staff_roles`, schema, data contract, factories; the 4.2 tests updated and passing
- [ ] `permissions.ts` and its snapshot test; `Actor`, `requireUser`, `requirePermission`, `assertNoConflict`, `AuthzError`, the middleware; unit tests first
- [ ] The permission suite and a referred-quote-item factory; integration tests first, failing
- [ ] The eight data functions until the suite passes
- [ ] The lint rule (call 11), and fixing anything it flags
- [ ] `auth:make-admin` with integration tests
- [ ] `/account` on `requireUser`; the empty `_staff` layout and guard; e2e check of both redirects
- [ ] Docs: engineering.md §7 (roles and permissions table, decisions 5–8, calls 9–15), 02-schema.md (a note that 4.5 moved roles to `staff_roles`), `phase.md` (4.5 and 4.5b rows, anchoring in 4.11), `build-plan.md`
- [ ] `vp check`, `vp test`, `vp build`
- [ ] You run `vp run db:migrate` on Neon `dev` (staging and production apply `0006` in the build)
- [ ] You run `auth:make-admin` on Neon `dev` for your own account, and we check the `staff_members` and `staff_roles` rows in the console

## Tests

| Layer | Test | Gate |
|---|---|---|
| Unit | The map snapshot; every permission granted somewhere; `requireUser`, `requirePermission` (union of roles, deactivated refused, no roles refused), `assertNoConflict`, the error mapper (no stack trace, friendly message) | yes |
| Integration | `0006`: an existing `staff_members.role` is copied into `staff_roles`; a bad role and a duplicate `(user_id, role)` are refused | yes |
| Integration | The permission suite above: every function × eight actors, expected results from the map, cross-user ids, several roles, and the completeness check | yes |
| Integration | `auth:make-admin`: makes an admin with the next staff code and an `admin` row in `staff_roles`; refuses an unknown email, an unverified email and an existing staff member | yes |
| Lint | `getDb` or `ROLE_PERMISSIONS` imported from a page or feature file fails `vp check` | yes |
| Integration | `getStaffAccess()` answers `guest`, `customer` (including a deactivated member and one with no roles) and `staff` | yes |
| E2E | Signed out → `/staff` redirects to `/login`. (A signed-in customer can't be made on the preview, since sign-up needs the emailed link (4.4b), so the customer → `/account` redirect is covered by the integration test above.) | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass; `ci` green on the PR.
- [ ] No function checks a role name; every staff check goes through `requirePermission`.
- [ ] The permission suite covers all eight functions, takes its expectations from the map, and fails if a new function is added without a declared permission.
- [ ] You are an admin on Neon `dev`, made by the script.

## Commit message

`feat: permission-based authorization with multi-role staff, scoped customer and staff reads, conflict-of-interest rule, make-admin script and a permission suite`

## Sources

- engineering.md §7 (roles table, enforcement layers, tests), §9 (errors and logs); 02-schema.md decisions 7, 15 and 18 and the 4.2 review follow-ups; 04-better-auth.md (`/account` guard).
- `src/server/db/schema/{staff,values,customers,policies,claims,quotes,underwriting,relations}.ts`, `src/server/db/data-contract.ts`, `src/test/factories.ts`, `src/features/auth/session.ts`, `src/routes/account.tsx`.

## Files

- **New:** `src/server/auth/{permissions,actor,middleware,errors}.ts`, `src/server/data/{policies,claims,referrals,index}.ts`, `src/server/data/permissions.int.test.ts`, `src/server/auth/permissions.test.ts`, `drizzle/0006`–`0008` (staff roles: add the table; copy rows and add triggers; drop the column), `scripts/{make-admin,make-admin-core}.ts`, `src/routes/_staff.tsx`, `src/routes/_staff/staff.tsx`, `src/features/staff/access.ts`, tests.
- **Changed:** `src/server/db/schema/{staff,relations}.ts`, `src/server/db/data-contract.ts`, `src/server/db/constraints.int.test.ts`, `src/test/factories.ts` (`roles`, a referred quote item, a deactivated staff member), `src/features/auth/session.ts`, `src/routes/account.tsx`, `vite.config.ts` (the `lint` rules, with an override for the allowed folders), `package.json` (`auth:make-admin`), `plan/engineering.md`, `plan/phases/04-data-auth/02-schema.md`, `plan/phases/04-data-auth/phase.md`, `plan/build-plan.md`.
