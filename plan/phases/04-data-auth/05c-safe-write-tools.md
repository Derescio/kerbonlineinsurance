# 4.5c Safe write tools

**Status:** built (approved 5 Nov 2026; branch `slice/4.5c-safe-write-tools`, not yet merged; staging check still to do)
**Phase:** 04-data-auth

## Goal

Four tools that every later write uses, so slices 5.6, 6.3, 6.7, 6.10 and 6.11 don't each solve the same problems again:

- **`withTx`.** A write with several steps commits completely or not at all.
- **`withIdempotency`.** A double tap or a browser retry gets the first answer back instead of writing twice.
- **`limit()`.** Someone hammering a form, signed in or not, is told to slow down.
- **The validation-error contract.** A rejected input shows a plain message next to the right field, in the same way on every form, and never a database message or a stack trace.

A fifth piece, `defineWrite`, chains them in a fixed order. It is to writes what 4.5's `defineRead` is to reads. A small browser half (`useIdempotencyKey` and `writeOutcome`) gives forms their key and turns a thrown error into what the form does next.

Success: when 5.6 builds quote saving and "Pay and start cover", it imports these tools and writes none of this itself, and the tests prove each failure can't happen.

## Decisions (agreed 5 Nov 2026)

1. **4.5c is its own slice** (Damion, at the 4.5b split). It is tested on its own and reaches `main` in the Phase 4 release with 4.5 and 4.5b.
2. **`withTx` gets real callers now; the other three are tested on their own** (Damion).
   - **The `withTx` callers:** the three transactions that already exist move onto it: `staffGetClaim`, `staffGetReferral` (4.5b said `withTx` would wrap them) and `removeUnverifiedPassword` (sign-in linking).
   - **The other three tools:** nothing in Phase 4 honestly needs `withIdempotency`, `limit()` or the server half of the validation contract yet. Their first callers are 5.6's quote pricing, quote save and pay.
   - **If a tool doesn't fit:** 5.6 changes the tool itself. No other code uses it yet.
3. **A guest's quote stays in the browser until the sign-in step** (4.2, schema decision 5; built in 5.6). So `withIdempotency` only ever serves signed-in users. `limit()`, though, must also work for guests, because getting a price happens before sign-in.

Agreed after the spec review (Damion, 5 Nov 2026):

4. **A write can refuse from inside its transaction.** `run` may return `rejected(message, fields?)` (pay finds the quote expired or already paid). The transaction rolls back, nothing is stored against the key, and the caller gets `{ ok: false, error }` like a validation failure, so 5.6 can say "This quote has expired" next to the button (call 9).
5. **A replay is checked before the rate limit.** A retry of a write that already succeeded gets its first answer and uses up no allowance, so a retried pay never gets a 429 (call 10).
6. **The browser half is in 4.5c:** the key's lifecycle and the mapping from a thrown code to what the form does (call 19).
7. **`defineWrite` is `"signed_in"` only.** Writes that need a staff permission, and the permission suite's write branch, come with their first caller (6.10).
8. **Proving the code reaches the browser** is a unit round trip through Start's serialisation plugins plus an integration test against a test-only server function, not an E2E.

## Calls I've made (check these)

9. **Validation failures and rejections are returned; every other failure is thrown.**
   - A bad input, or a refusal the user can act on (decision 4), is an expected outcome, so the write returns a typed result: `{ ok: false, error: ValidationFailure }`.
   - Everything else (not signed in, rate limited, a key reused with different details, any bug) is thrown as 4.5's `PublicError`: a code, a status and a fixed sentence.
   - **Why it's returned:** a returned value keeps its type end to end, and field errors are part of it.
   - **A rejection** uses the same shape. `fields` may be empty, and then the form shows `message` by its submit button. The message is a fixed sentence written by the caller, never containing a value.
   - **Unique violations stay `INTERNAL`.** A write checks its rules first and returns `rejected` (5.6 checks "already paid" before inserting the policy). The constraint is the backstop for a race, and a race is rare enough for "Something went wrong".
   - **The code has to reach the browser.**
     - **The problem:** TanStack Start (1.169) serialises a thrown error as a plain `new Error(message)`. That's in router-core's `ShallowErrorPlugin`, and the repo registers no adapter. So today the code is lost, and the status survives only as the HTTP status (Start reads `error.status`).
     - **Why it matters:** a 5.6 form needs the code. On `UNAUTHENTICATED` it sends a guest to sign in. On `IDEMPOTENCY_CONFLICT` it makes a fresh key.
     - **The fix:** `PublicError` gets a serialisation adapter (`createSerializationAdapter`, registered in `createStart({ serializationAdapters })` in `src/start.ts`). Start puts registered adapters ahead of its default plugins, so the adapter wins over `ShallowErrorPlugin`. The browser then receives a `PublicError` with `code`, `status` and `message`.
     - **Rebuilding it:** the constructor takes any error and maps it. The adapter needs a second way in, `PublicError.from({ code, status, message })`, which only the adapter uses.
     - **`errors.ts` runs in the browser** once `start.ts` imports it, so it stays free of server-only imports (today it imports only `@tanstack/react-router`).
     - **Only `PublicError` crosses.** Every other error is turned into a `PublicError` on the server first (`publicErrorFor`).
   - **Every server function converts its errors.** Today only `userMiddleware` and `permissionMiddleware` do (their `fail()` wraps `next()`, which rethrows handler errors). Guest pricing can use neither, so a new `actorMiddleware` puts `actor: Actor | null` on the context and converts errors the same way. A server function with none of the three must not throw.
   - **Write server functions don't use a zod `inputValidator`.** Start would throw zod's issues before `defineWrite` sees them: inside middleware as an `INTERNAL` 500, without it as the issue list itself. They pass the raw input through (an identity `inputValidator` for its type) and let `defineWrite` validate.
10. **The order is fixed.** `defineWrite` runs these steps in order, and each step stops the request before the next one runs:
   1. access (signed in)
   2. validation, including the idempotency key
   3. replay: a read-only lookup of a committed, unexpired key (idempotent writes only)
   4. rate limit
   5. transaction: the key row (idempotent writes only), `run`, the stored response

   - **Why validation comes first:** bad input never uses up a user's allowance, and never touches the database.
   - **Why the replay comes before the limit:** a retry of a write that already succeeded returns its first answer without counting (decision 5). A matching key with a different request is `IDEMPOTENCY_CONFLICT` here too.
   - **A refused request still leaves no key:** only the lookup is early. The key row is inserted inside the transaction (call 13), after the limit.
   - **Writes outside `defineWrite`:** a write that can't use it (none planned) must follow the same order by hand.
   - **Server functions that save nothing call `limit()` directly.** 5.6's guest quote pricing is one: it reads and computes but stores nothing (decision 3). It uses `actorMiddleware` and calls `limit()` with `rateLimitSubject()` after its input check.
11. **`withTx` fails fast instead of hanging.**
   - Every transaction starts with one statement, `select set_config('statement_timeout', '10s', true), set_config('lock_timeout', '5s', true)` (the transaction-local form of `SET LOCAL`, in one round trip). A stuck query or a long wait for the audit lock then ends with an error, instead of holding a Vercel function until its own time limit.
   - `lock_timeout` also bounds a second request waiting on the first's key row (call 13). If the first takes longer, the second fails with "Something went wrong", and its retry with the same key gets the stored answer.
   - It keeps Postgres's default isolation (READ COMMITTED), which `audit()` relies on (4.5b), and offers no option to change it.
12. **Only `src/server/db/tx.ts` may call `.transaction(` in app code.** A unit test scans `src/` for the call and fails when it finds it anywhere else. That's the same approach `analytics.test.ts` uses for its imports, because oxlint can't express this rule.
   - **Test code is exempt** (`*.test.ts`, `*.test.tsx` and `src/test/`). `app-role.int.test.ts` needs its own always-rolled-back transactions, and the audit tests open transactions directly. Neither should pick up the app's timeouts.
   - Today the only matches are the three callers and test files. `Db["transaction"]` in `audit.ts` is a type and doesn't match.
13. **How idempotency works.**
   - **In:** the user, the key, an `action` name and the parsed payload.
   - **The payload is normalised, then hashed.** `toJson(value)` is a `JSON.stringify` round trip: a `Date` becomes its ISO string and an `undefined` key is dropped, the same as the browser's JSON would. `request_hash` is SHA-256 of `canonicalJson({ action, payload: toJson(payload) })`, so key order doesn't matter. Only the hash is stored, so the payload doesn't need the audit chain's value rules.
   - **The replay lookup (step 3)** selects the row for user and key. An unexpired row with the same hash returns its stored response; with another hash it's `IDEMPOTENCY_CONFLICT`. No row, or an expired one, goes on.
   - **Inside the transaction (step 5):**
     - `INSERT … ON CONFLICT (user_id, key) DO UPDATE SET request_hash, response = null, created_at, expires_at WHERE idempotency_keys.expires_at <= now() RETURNING`. A new or expired key returns the row, and the write goes ahead.
     - **No row returned** means another request committed the key first (this one waited on its row, bounded by `lock_timeout`). A `SELECT` then reads it (READ COMMITTED takes a fresh snapshot per statement): same hash returns its response, another hash is `IDEMPOTENCY_CONFLICT`. A plain `INSERT` wouldn't work: the unique violation aborts the transaction before the stored response can be read.
     - It runs the write, then stores the response on the row.
   - **Atomic:** the key row commits together with the write. If the write fails or returns `rejected`, the row rolls back too, so a retry runs fresh. A key can never be stuck half-used.
   - **Same key, different `action` or payload:** refused with `IDEMPOTENCY_CONFLICT` (409): "This form was already sent with different details. Refresh the page and try again."
   - **An expired row** (older than 24 hours) counts as absent. It's replaced in place.
   - **The response is JSON both times.** `run`'s result type is JSON-shaped (`T extends JsonValue`), and the first call also returns `toJson(result)`, so the first answer and a replay are equal. Responses should hold ids and statuses, never personal data.
   - **The key** must be a UUID (`z.uuid()`). The browser makes it (call 19), so a non-UUID key is a validation failure on `idempotencyKey`.
   - **From `chain.ts`:** it exports `JsonValue` (today's `AuditValue`) and `canonicalJson`, the private `canonical()` made public unchanged. The chain keeps its own checks in `assertChainable`.
14. **How the rate limit works.**
    - `limit(key, { max, windowSeconds })` uses a sliding window over two fixed windows in `rate_limits`. The estimate is the previous window's count, weighted by how much of it still overlaps, plus the current window's count.
    - **The database's clock:** the window start and the overlap come from `now()` in the same statement, not from each function instance's clock.
    - **Counting:** each attempt atomically increments the current window (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), and the request is refused when the estimate exceeds `max`.
    - **Refused attempts count too,** so hammering keeps the client blocked.
    - **It runs outside the write's transaction,** so an attempt still counts when its write later fails, rolls back or returns `rejected`. Otherwise failing attempts would be free.
    - **When it refuses:** it throws `RATE_LIMITED` (429) with the sentence from engineering.md §10: "You're going a bit fast. Try again in a minute." Auth's `TOO_FAST` ("Wait a few minutes") stays as it is, because Better Auth's windows are minutes long.
    - **If the database is down,** it fails closed. The write would fail anyway.
15. **Who a rate limit counts.**
    - `rateLimitSubject(actor, headers)` returns `user:<userId>` for a signed-in user.
    - For a guest it returns `ip:<hash>`, a keyed hash of the IP from `hashIp()` in `request-info.ts`, keyed with `BETTER_AUTH_SECRET` as security events are. The raw IP is never stored or logged.
    - **IPv6 is counted by its /64**, because one client can rotate through the addresses in its /64. An IPv6 address is cut to its first four groups before hashing. Security events keep hashing the full address.
    - **Shared addresses:** a mobile network can put many guests behind one IPv4 address, so guest rules need generous limits. Each rule says why its numbers are what they are.
    - With no IP (local development), guests share `ip:unknown`.
    - **The full key** is `<action>:<subject>`, for example `quote.price:ip:3f9a…`.
    - **Rules:** 4.5c defines none. The first caller creates `src/server/db/rate-limit-rules.ts`, and every later rule goes in it so they can be reviewed together, the way `ROLE_PERMISSIONS` is.
16. **The validation contract.**
    - **The shape:** `ValidationFailure = { code: "VALIDATION", message: string, fields: Record<string, string> }`. A rejection (decision 4) uses it too.
    - **Field keys:** a field's key is its zod path joined with `.`. Examples: `postcode`, `vehicle.registration`, `drivers.0.dateOfBirth`.
    - **One message per field:** the first issue on each field wins.
    - **Root issues:** an issue on the whole form (an empty path) sets `message`. Otherwise `message` is "Check the highlighted fields."
    - **Wording:**
      - **Where messages come from:** the zod schema, which the form and the server function share.
      - **Defaults:** one error map in `src/lib/validation.ts` gives plain defaults for any field without its own message, such as "This field is required." or "Check this field."
      - **How the map is applied:** it's passed to each parse (`safeParse(raw, { error })`) by `parseInput`. It isn't set globally with `z.config`, because Better Auth uses the same zod and its own validation would change too.
      - **What it rules out:** zod's built-in English ("Expected string, received number") never reaches a user.
      - **Precedence:** zod 4.6 checks a field's own message before the per-parse map, so the map only fills gaps. Every auth schema rule already has its own message, so the auth screens' wording doesn't change.
    - **No values:** a message never repeats the value that was typed.
    - **Not logged:** validation failures and rejections are user outcomes, not faults.
17. **One display path for both sides.**
    - The auth screens already turn zod errors into field messages and move focus to the first invalid field (`fieldErrors` and `focusFirstError` in `src/features/auth/form.ts`).
    - They move into `src/lib/validation.ts`, split in two: the browser's check calls `parseInput`, and both its `ValidationFailure` and a server's go to the form the same way. `FieldErrors` becomes `Record<string, string>` keyed by the dotted path.
    - The auth forms keep working the same for the user.
18. **Where the files go.** `tx.ts`, `idempotency.ts` and `rate-limit.ts` go in `src/server/db/`, where database access is already allowed (4.5, call 11). engineering.md's paths (`src/server/db/tx.ts`, `src/server/rate-limit.ts`) are updated to match. `defineWrite` goes next to `defineRead` in `src/server/data/define.ts`. The browser half goes in `src/lib/writes.ts`.
19. **The browser half.**
    - **`useIdempotencyKey(scope)`** makes a key with `crypto.randomUUID()` when the form mounts and returns `{ key, rotate }`.
      - It keeps the key in `sessionStorage` under the scope, so a reload or the sign-in redirect (the same tab) reuses it. A reload after a pay whose answer was lost then gets the stored answer instead of paying twice.
      - Storage can throw (private windows), so every read and write is in try/catch and it falls back to memory.
      - The form calls `rotate()` after a success and after `IDEMPOTENCY_CONFLICT`. Otherwise a second save from the same open form would be refused.
    - **`writeOutcome(error)`** turns a thrown error into what the form does: `UNAUTHENTICATED` → `{ kind: "sign_in" }` (the form sends the user to `/login` with a return path); `IDEMPOTENCY_CONFLICT` → `{ kind: "message", rotateKey: true }` with the sentence; any other `PublicError` → `{ kind: "message" }` with its sentence; anything that isn't a `PublicError` (the network dropped) → `{ kind: "message" }` with "Something went wrong. Please try again." and the key kept, so the retry is safe.
    - Buttons disabling while a request is in flight (engineering.md §8) stay each form's job.
20. **Clearing old rows is 4.11's job.** Expired `idempotency_keys` rows and old `rate_limits` windows are deleted by 4.11's daily job. 4.5c's tools ignore them (an expired key counts as absent, and old windows don't count), so nothing breaks before then.

## In scope

### `withTx` (`src/server/db/tx.ts`)

- **`withTx<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T>`.** It sets the two timeouts (call 11), runs `run`, and commits. Any throw rolls back and rethrows the same error. It takes a `Db`, not a `Tx`, so it can't be nested.
- **The `Tx` type** moves here from `src/server/audit/audit.ts`. `audit()` imports it from here.
- **The three existing transactions** move onto it, with no change to what they do or return: `staffGetClaim`, `staffGetReferral` and `removeUnverifiedPassword`.
- **The source-scan test** (call 12).

### `withIdempotency` (`src/server/db/idempotency.ts`)

- **`findReplay(db, { userId, key, action, payload })`:** the read-only lookup (call 13). It returns the stored response, throws `IDEMPOTENCY_CONFLICT`, or returns nothing.
- **`withIdempotency<T extends JsonValue>(db: Db, input: { userId: string; key: string; action: string; payload: unknown }, run: (tx: Tx) => Promise<T | Rejected>): Promise<T | Rejected>`.**
  - It runs its own `withTx` around the key row and `run` (call 13). `run` gets that transaction, so the write, any `audit()` call and the key row all commit together.
  - A `Rejected` result rolls the transaction back (key row included) and is returned.
- **`toJson`** (call 13).
- **`IdempotencyConflictError`** maps to `PublicError` code `IDEMPOTENCY_CONFLICT`, with status 409 and the fixed sentence.
- **Out-of-date docs:** the schema comment on `idempotency_keys.response` ("Null while the request is in flight") and engineering.md §8's description are updated. Under this design no row with a null response is ever committed.

### `limit()` (`src/server/db/rate-limit.ts`)

- **The functions:** `limit(key: string, rule: { max: number; windowSeconds: number }): Promise<void>` and `rateLimitSubject(actor: Actor | null, headers: Headers): Promise<string>` (calls 14 and 15).
- **The error:** `RateLimitError` maps to `PublicError` code `RATE_LIMITED`, with status 429 and the fixed sentence.
- **The log:** a refusal logs `[rate-limit] <action>` and nothing else: no user id, no IP hash, no key.

### The validation contract (`src/lib/validation.ts`)

- **`parseInput<S>(schema: S, raw: unknown)`** returns `{ ok: true, data: z.infer<S> }` or `{ ok: false, error: ValidationFailure }` (call 16).
- **The zod error map** with plain defaults, loaded on both sides.
- **`fieldErrors` and `focusFirstError`** move here from `src/features/auth/form.ts`, split and extended to nested paths (call 17). The auth screens import them from here.
- **`WriteResult<T> = { ok: true; data: T } | { ok: false; error: ValidationFailure }`.** It's what every write server function returns.

### The browser half (`src/lib/writes.ts`)

- **`useIdempotencyKey(scope)`** and **`writeOutcome(error)`** (call 19).

### `defineWrite` (`src/server/data/define.ts`)

- **Signature:** `defineWrite(input, options, run)`.
  - `input` is a zod schema.
  - `options` is `{ limit?: { action: string; rule }; idempotent?: { action: string } }`.
  - `run` is `(actor, data, tx) => Promise<T | Rejected>`. `rejected(message, fields?)` is exported next to it.
- **What it returns:** a function `(actor, raw: { input: unknown; idempotencyKey?: unknown }, ctx: { headers: Headers }) => Promise<WriteResult<T>>`, carrying `access: "signed_in"` and `kind: "write"`.
  - The server function's input is that `raw` envelope, so the key travels beside the form's values and is never part of the hashed payload.
  - An idempotent write requires an `idempotencyKey`. Leaving it out, or sending a non-UUID, is a validation failure on the field `idempotencyKey`.
- **The order is call 10's.**
- **The permission suite:** its completeness check skips exports marked `kind: "write"` until 6.10 adds the write branch (decision 7). A write's signed-in-only access is tested in `defineWrite`'s own tests.
- **No real writes use it yet.** The tests define test-only writes.

### Errors and middleware (`src/server/auth/errors.ts`, `middleware.ts`)

- **`PublicCode`:** `PublicError.code` becomes `AuthzCode | "RATE_LIMITED" | "IDEMPOTENCY_CONFLICT" | "INTERNAL"`. The two new codes don't join `AuthzCode`, since they aren't authorisation failures; `toPublicError` maps their error classes, each with its status and fixed sentence.
- **`PublicError.from`** and the serialisation adapter, registered in `src/start.ts` (call 9).
- **`actorMiddleware`:** the actor or null on the context, with the same error conversion as the other two (call 9).

## Out of scope

- **Real writes** that use `withIdempotency`, `limit()` or `defineWrite`: these start in 5.6.
- **Writes that need a staff permission** and the permission suite's write branch: 6.10 (decision 7).
- **Saving a guest's quote on the server:** 5.6, after sign-in (decision 3).
- **Deleting expired rows:** 4.11 (call 20).
- **Any rate-limit rules,** and the rules file: each first caller adds its own.
- **Retrying a transaction after a deadlock or serialisation failure.** Under READ COMMITTED with one audit lock, neither is expected. It can be added if one shows up.
- **Mapping unique violations to friendly messages** (call 9).
- **Edge rate limits** (Vercel Firewall, 1.5) and Better Auth's limiter (4.4) stay as they are. `limit()` doesn't duplicate either.

## What you set up

Nothing. There are no new environment variables or tables, and no Neon or Vercel steps. `idempotency_keys` and `rate_limits` have existed since 4.2. `kerb_app` already has `SELECT`, `INSERT`, `UPDATE` and `DELETE` on both (4.5b), and the drift check already covers them.

## Steps

- [x] You approve this spec
- [x] `withTx`, the `Tx` move, the three callers, the source-scan test
- [x] `parseInput`, the zod error map, `fieldErrors` and `focusFirstError` moved, split and extended, the auth screens on the shared contract
- [x] `PublicCode`, `PublicError.from`, the adapter in `start.ts`, `actorMiddleware`
- [x] `limit()`, `rateLimitSubject()`, `RATE_LIMITED`
- [x] `toJson`, `canonicalJson` and `JsonValue` from `chain.ts`, `findReplay`, `withIdempotency`, `IDEMPOTENCY_CONFLICT`
- [x] `defineWrite`, `rejected`, the completeness check skipping writes
- [x] `useIdempotencyKey` and `writeOutcome`
- [x] Docs:
  - engineering.md §8 (`withTx` timeouts, the source-scan rule, how idempotency works, rejections) and §10 (the limiter, guests by IP hash and IPv6 /64, the rules file)
  - the error contract, where engineering.md describes errors (`PublicError` crossing, `actorMiddleware`, no zod `inputValidator` on writes)
  - `phase.md` (4.5c)
  - `build-plan.md`
- [x] `vp check`, `vp test`, `vp build`

## Tests

| Layer | Test | Gate |
|---|---|---|
| Integration | `withTx`: a write across two tables that then throws leaves neither row; a clean run commits and returns its value; inside it, `show statement_timeout` is `10s` and `show lock_timeout` is `5s` | yes |
| Unit | The source scan: `.transaction(` appears nowhere in `src/` except `tx.ts` | yes |
| Integration | The three moved callers: the existing permission-suite, audit and linking tests still pass unchanged | yes |
| Unit | `toJson` and the request hash: a `Date` becomes its ISO string, an `undefined` key is dropped, key order doesn't change the hash, a different action or payload does; `canonicalJson` gives the same text as the audit chain's canonical form | yes |
| Integration | `withIdempotency`: the first call runs once; a repeat with the same key and payload returns an equal result without running again; same key with another payload → `IDEMPOTENCY_CONFLICT`; same key with another action → `IDEMPOTENCY_CONFLICT`; a `run` that throws leaves no key row, and the retry runs; a `run` that returns `rejected` leaves no key row and no write, and the retry runs; two simultaneous calls with one key run once and both get the same result; an expired key (backdated through the owner connection) runs again; two users with the same key don't affect each other; a result holding a `Date` (forced past the type) comes back as the same ISO string both times | yes |
| Integration | `findReplay`: a committed key with the same request returns its response; with another request → `IDEMPOTENCY_CONFLICT`; an expired or missing key returns nothing | yes |
| Integration | `limit()`: allows `max`, then refuses with `RATE_LIMITED`; two keys don't affect each other; 20 simultaneous attempts with `max` 10 and a one-day window let exactly 10 through; the previous window counts in proportion to its overlap (windows backdated through the owner connection); once both windows have passed, attempts are allowed again; a refused attempt still counts | yes |
| Unit | `rateLimitSubject`: a signed-in actor → `user:<id>`; a guest with an IP → `ip:<64 hex>`, never containing the IP; two IPv6 addresses in one /64 → the same subject, in different /64s → different; no IP → `ip:unknown` | yes |
| Unit | `parseInput`: nested and array paths (`drivers.0.dateOfBirth`); the first issue per field; a root issue sets `message`; a field with no custom message gets a plain default, never zod's built-in text; a message never contains the typed value | yes |
| Unit | `toPublicError`: `RATE_LIMITED` → 429 and `IDEMPOTENCY_CONFLICT` → 409, each with its fixed sentence | yes |
| Unit | The `PublicError` adapter: a round trip through Start's plugins (`toCrossJSONAsync` and `fromJSON`, adapters first as Start orders them) gives a `PublicError` with the same `code`, `status` and `message`. The serialised form holds nothing else: no stack and no cause. A plain `Error` still crosses as message only | yes |
| Integration | A test-only server function behind `userMiddleware`, called as a guest through Start's server-function handler, answers 401 with a serialised `PublicError` whose code is `UNAUTHENTICATED`; one behind `actorMiddleware` that throws a `RateLimitError` answers 429 with `RATE_LIMITED`. The plan decides how Vitest drives the handler | yes |
| Integration | `defineWrite` order: a guest → `UNAUTHENTICATED` before validation; bad input → `{ ok: false }` with no rate-limit row and no write; an idempotent write with no key or a non-UUID key → a validation failure on `idempotencyKey`; past the limit → `RATE_LIMITED` with no key row and no write; a replay of a committed write with the limit already used up → the stored response, not `RATE_LIMITED`, and no new count; `rejected` → `{ ok: false }` with no write, no key row and no `audit()` row, and the attempt counted; a clean call → `{ ok: true }` with the write, the key row and any `audit()` row committed together | yes |
| Integration | The permission suite's completeness check skips a `kind: "write"` export and still fails on a read with no case | yes |
| Component | A server `ValidationFailure` shown through the shared display path: each named field gets its message, `aria-invalid` and `aria-describedby`, and focus moves to the first; a rejection with no fields shows its message by the submit button; the existing auth form tests still pass | yes |
| Component | `useIdempotencyKey`: the same key across re-renders and a remount in the same tab; a new key after `rotate()`; still works when `sessionStorage` throws. `writeOutcome`: each code maps as call 19 says, and a non-`PublicError` keeps the key | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The three existing transactions run through `withTx` on staging (sign-in linking and the staff reads behave as before).
- [ ] 5.6's spec can say "its writes use `defineWrite` with `limit` and `idempotent`, its forms use `useIdempotencyKey` and `writeOutcome`, and pricing uses `actorMiddleware` and `limit()`", and add nothing else for these concerns.
- [ ] A thrown server error reaches the browser with its code, not just its sentence.

## Commit message

`feat: withTx with timeouts, withIdempotency, the shared limit() rate limiter, the validation-error contract, defineWrite and the browser key helper`

## Sources

- **engineering.md:** §8 (transactions, idempotency), §10 (rate limiting) and §9 (errors and logs).
- **Specs:** 02-schema.md decision 5 (a guest's quote stays in the browser); 05-authorization.md (`defineRead`, `PublicError`, `logSafeError`, call 15 on database imports); 05b-audit-integrity.md (`audit()` relies on READ COMMITTED; `withTx` wraps the staff reads); `plan/phases/05-quote/phase.md` (5.6: pay, quote saves, a guest quote kept through sign-in).
- **Code:**
  - `src/server/db/schema/platform.ts` (`idempotency_keys`, `rate_limits`)
  - `src/server/auth/{errors,request-info,linking,middleware}.ts`
  - `src/server/data/{define,claims,referrals,permissions.int.test}.ts`
  - `src/server/audit/{audit,chain}.ts`
  - `src/features/auth/form.ts`
  - `src/start.ts`
  - `src/components/forms/`
- **Libraries checked (5 Nov 2026):** `@tanstack/start-client-core` 1.170 (`getSerovalPlugins` puts adapters first; middleware `next()` rethrows handler errors; `execValidator` throws zod issues as an `Error`), `@tanstack/start-server-core` 1.169 (`resolveErrorStatus` reads `error.status`), `@tanstack/router-core` 1.171 (`ShallowErrorPlugin`, `createSerializationAdapter`), zod 4.6.7 (`ParseContext.error`).

## Results (6 Nov 2026, before the PR)

Changes from the spec:
- **The server-function integration test became a unit middleware test plus a serialiser round trip** (plan Task 3). Start's compiler isn't loaded in Vitest, so `createServerFn` can't run there. The cost: the HTTP-status path (`resolveErrorStatus`) is checked only by reading Start's source. An end-to-end test in 5.6 would catch a regression.
- **The round-trip test decodes with seroval's `fromCrossJSON`**, not `fromJSON`. `fromJSON` can't read what `toCrossJSONAsync` writes; `fromCrossJSON` is its pair and is what Start's client uses.
- **`RateLimitError` and `IdempotencyConflictError` live in `src/server/auth/errors.ts`**, with the other public errors.
- **`Rejected` lives in `src/lib/validation.ts`**, so the browser side can import it without touching server code.
- **The completeness check's write filter is covered by a `kind` assertion in `define.int.test.ts`**, not by a test of the test. The existing completeness test already fails on a read with no case. The cost: a filter that skipped reads too would go unnoticed until a read lacks a case.
- **The previous-window test uses a count of 1e9**, not the plan's 1000. With a one-day window, 1000 fails after about 23:57 UTC, because the previous window's share shrinks through the day. The spec pins no number.
- **`ResendVerification.tsx` also moved its imports** to the shared validation module, so it compiles.
- **`rateLimitIp` also strips IPv6 zone ids** (the `%eth0` part) before grouping by /64.
- **The rate-limit refusal logs with `console.warn`** (the action name only). `fail()` doesn't log it again.
- **`seroval` is a devDependency**, pinned to Start's version. A Dependabot bump of Start needs it to follow.
- **`fieldErrors` also returns `message` on failure** (the whole-form sentence, e.g. a root-level refine), so a form can show it when `errors` is empty.
- **`useIdempotencyKey` follows scope changes.** A route component that stays mounted while its params change gets the new scope's key, and `rotate()` writes to the new scope's slot.

What was built:
- Server: `src/server/db/tx.ts` (`withTx`, `Tx`, timeouts of 10s and 5s, `Rejected` rolls back), `rate-limit.ts` (`limit()`, `rateLimitSubject()`, guests by keyed IP hash, IPv6 by /64), `idempotency.ts` (`findReplay`, `withIdempotency`, `toJson`, `JsonValue`; `canonicalJson` shared with `chain.ts`). `src/server/data/define.ts` has `defineWrite`. `src/server/auth/errors.ts` has `PublicCode`, `PublicError.from`, `RATE_LIMITED` and `IDEMPOTENCY_CONFLICT`; `middleware.ts` has `actorMiddleware`; `src/start.ts` has the serialisation adapter.
- Callers moved to `withTx`: sign-in linking and the two staff reads.
- Browser: `src/lib/validation.ts` (`parseInput`, the zod error map, `fieldErrors`, `focusFirstError`, `rejected`), `src/lib/writes.ts` (`useIdempotencyKey`, `writeOutcome`). The auth forms use the shared contract.
- Docs: engineering.md §8, §9 and §10, `phase.md`, `build-plan.md`.
- Tests: 797 passing (`vp test`): 323 unit, 318 integration, 156 component. Integration covers `withTx` rollback and timeouts, the source scan, `withIdempotency` and `findReplay` (replay, conflict, rollback, concurrency, expiry, per-user keys), `limit()` (concurrency, window proportion, refused attempts counting), and `defineWrite` order. Unit covers `parseInput`, `toPublicError`, the `PublicError` round trip, `rateLimitSubject` and the middleware. Component covers the shared field display and `useIdempotencyKey` / `writeOutcome`.

Still to do:
- The staging check: sign-in linking and the staff reads behave as before through `withTx`.
- The staging check that a thrown server error reaches the browser with its code: call a `userMiddleware`-backed server function signed out (or the first such function that exists) and confirm a 401 whose body decodes to a `PublicError` with code `UNAUTHENTICATED`.
- 5.6 writes its first `defineWrite` function and creates `rate-limit-rules.ts`.
- Known limits a later slice could trip on:
  - A first request that holds its key row longer than `lock_timeout` (5s) makes the waiting retry fail with a generic "Something went wrong" (Postgres 55P03). The retry after that gets the stored answer.
  - With `sessionStorage` blocked, `useIdempotencyKey` keeps the key per component instance, so a remount gets a new key.
  - Hex-form IPv4-mapped IPv6 addresses (`::ffff:cb00:7107`) aren't unwrapped and share one guest bucket.
  - `rateLimitSubject`'s default secret parses the whole auth env even for a signed-in actor.
