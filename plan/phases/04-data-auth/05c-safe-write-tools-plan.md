# 4.5c Safe write tools: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `withTx` (timeouts, all-or-nothing), `withIdempotency` (a repeat gets the first answer), `limit()` (a Postgres sliding window for users and guests), the validation-error contract, `defineWrite` chaining them in a fixed order, a `PublicError` that reaches the browser with its code, and the browser half (`useIdempotencyKey`, `writeOutcome`).

**Architecture:** The database tools live in `src/server/db/` (`tx.ts`, `rate-limit.ts`, `idempotency.ts`). `defineWrite` sits next to `defineRead` in `src/server/data/define.ts` and calls them in the spec's order: access, validation, replay, limit, transaction. The pure contract (`ValidationFailure`, `parseInput`, `Rejected`) is in `src/lib/validation.ts`, so the form and the server share it. Errors stay in `src/server/auth/errors.ts`, which now also runs in the browser through a serialisation adapter registered in `src/start.ts`.

**Tech Stack:** TanStack Start 1.169 (router-core 1.171), Drizzle 0.45 + node-postgres, zod 4.6, Postgres 18 (Docker on `localhost:5433`, CI on 5432), Vitest via `vite-plus/test` (projects `unit`, `integration`, `component`), `vitest-browser-react`.

**Spec:** [05c-safe-write-tools.md](05c-safe-write-tools.md) (approved 5 Nov 2026). It builds on [05-authorization.md](05-authorization.md) and [05b-audit-integrity.md](05b-audit-integrity.md) and their Results. Read the spec first. Call numbers below are the spec's.

## Global Constraints

- **Branch and PR:** branch `slice/4.5c-safe-write-tools` from `staging`. One commit per task (Conventional Commits). The PR goes into `staging`, is squash-merged with the spec's commit message, and is opened only when Damion says so. Nothing is pushed before then.
- **Fixed sentences (verbatim):**
  - `RATE_LIMITED` (429): "You're going a bit fast. Try again in a minute."
  - `IDEMPOTENCY_CONFLICT` (409): "This form was already sent with different details. Refresh the page and try again."
  - A form with field errors and no root issue: "Check the highlighted fields."
  - Error-map defaults: "This field is required." (a missing value) and "Check this field." (anything else).
  - A failure that isn't a `PublicError` in the browser: "Something went wrong. Please try again." (the existing `INTERNAL` sentence).
- **Timeouts:** `statement_timeout` `10s`, `lock_timeout` `5s`, set in one `select set_config(…, true), set_config(…, true)`. READ COMMITTED, never changed.
- **Idempotency:** keys are UUIDs (`z.uuid()`); rows expire after 24 hours (`now() + interval '24 hours'`, the database clock); `request_hash` is SHA-256 hex of `canonicalJson({ action, payload: toJson(payload) })`.
- **Rate limit:** the full key is `<action>:<subject>`; actions never contain `:`. Subjects: `user:<userId>`, `ip:<64 hex>`, `ip:unknown`. Window maths uses `now()` in SQL. A refusal logs `[rate-limit] <action>` and nothing else.
- **Only `src/server/db/tx.ts` calls `.transaction(`** in non-test code under `src/`.
- **`errors.ts` stays browser-safe:** it may import `@tanstack/react-router` and nothing from `#/server/db` or `node:*`.
- **Write server functions** (none in this slice) never use a zod `inputValidator`. Test code calls the functions directly.
- **Logs:** ids only, never emails, addresses, IPs, IP hashes or query values. Unexpected errors go through `logSafeError`.
- **Tests:** imports come from `vite-plus/test`. Integration tests call `truncateAll()` in `beforeEach` and `closeDb()` in `afterAll`, and backdate rows with `tamper()` (the owner connection). `vp check` and `vp test` pass at the end of every task (`vp run db:test:up` first).

## Review Focus

1. **IPv6 written in different ways:** `2001:DB8::1`, `2001:db8:0:0:1::2` and `2001:0db8:0000:0000:ffff::9` share a /64, so they get the same subject. An IPv4-mapped address (`::ffff:203.0.113.7`) is treated as `203.0.113.7`. Test in Task 4.
2. **Bad input and a missing key together:** an idempotent write whose input fails validation and whose key is missing reports both fields in one failure (`fields.title` and `fields.idempotencyKey`), not just the first. Test in Task 6.
3. **An expired key reused with a different payload** runs fresh and is not an `IDEMPOTENCY_CONFLICT`: after 24 hours the old request no longer counts. Test in Task 5.
4. **A stored key that isn't a UUID** (an old or hand-edited `sessionStorage` value) is replaced with a fresh UUID instead of being sent and failing validation every time. Test in Task 7.
5. **A retry whose input differs only in ways the schema normalises** (`" Car "` vs `"Car"` under `.trim()`) is a replay, not a conflict, because the hash is taken from the parsed data. Test in Task 6.

---

### Task 0: Branch, spec and plan

- [ ] **Step 1:** `git switch -c slice/4.5c-safe-write-tools` (from `staging`).
- [ ] **Step 2:** Commit the spec and this plan:

```bash
git add plan/phases/04-data-auth/05c-safe-write-tools.md plan/phases/04-data-auth/05c-safe-write-tools-plan.md
git commit -m "docs: 4.5c spec and implementation plan"
```

---

### Task 1: `withTx`, the `Tx` move, the three callers, the source scan

**Files:**
- Create: `src/server/db/tx.ts`, `src/server/db/tx.int.test.ts`, `src/server/db/tx.test.ts`
- Modify: `src/server/audit/audit.ts` (drop `Tx`, import it from `#/server/db/tx`), `src/server/data/claims.ts`, `src/server/data/referrals.ts`, `src/server/auth/linking.ts`

**Interfaces:**
- Produces: `type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]`; `withTx<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T>`; constants `STATEMENT_TIMEOUT = "10s"`, `LOCK_TIMEOUT = "5s"`.
- Task 5 extends `withTx`'s handling of a `Rejected` result. Here `withTx` only commits or rolls back on a throw.

- [ ] **Step 1: Write the failing integration tests** in `tx.int.test.ts`:
  - `rolls back every table on a throw`: inside `withTx`, insert a `jobs` row (`type: "test"`, `payload: {}`, `idempotencyKey: "tx-test"`) and a `rate_limits` row (`key: "tx-test"`, `windowStart: new Date()`), then throw `new Error("boom")`. Expect the rejection to be that same error object (`toBe`), and both tables to have 0 rows.
  - `commits and returns the value`: the same two inserts, returning `42` → resolves `42`, and both rows exist.
  - `sets the timeouts for this transaction only`: inside, `show statement_timeout` gives `"10s"` and `show lock_timeout` gives `"5s"`. After it, on `getDb()`, `show statement_timeout` gives `"0"`.
- [ ] **Step 2: Write the failing source scan** in `tx.test.ts`, modelled on `src/lib/analytics.test.ts:131`: walk `readdirSync("src", { recursive: true, encoding: "utf8" })`. Skip files ending `.test.ts` or `.test.tsx` and files under `test/`. Read the rest (`.ts`, `.tsx`). Expect the files matching `/\.transaction\(/` to equal `[join("server", "db", "tx.ts")]`.
- [ ] **Step 3: Run them to see them fail.** Run `vp test --project integration src/server/db/tx.int.test.ts` and `vp test --project unit src/server/db/tx.test.ts`. Expected: FAIL (no `tx.ts`; the scan finds `claims.ts`, `referrals.ts` and `linking.ts`).
- [ ] **Step 4: Implement `tx.ts`:** `db.transaction(async (tx) => { await tx.execute(sql\`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true), set_config('lock_timeout', ${LOCK_TIMEOUT}, true)\`); return run(tx); })`. The header comment covers: why the timeouts, READ COMMITTED for `audit()`, the scan rule, and that taking `Db` (not `Tx`) prevents nesting. Move `Tx` here. In `claims.ts`, `referrals.ts` and `linking.ts`, replace `db.transaction(` with `withTx(db, ` and change nothing else.
- [ ] **Step 5: Run the tests to see them pass**, plus the moved callers' suites: `vp test --project integration src/server/db/tx.int.test.ts src/server/data src/server/audit src/server/auth` and the unit scan. Expected: PASS.
- [ ] **Step 6: Commit** — `feat: withTx with statement and lock timeouts; staff reads and linking use it`

---

### Task 2: The validation contract

**Files:**
- Create: `src/lib/validation.ts`, `src/lib/validation.test.ts`, `src/lib/validation.browser.test.tsx`
- Modify: `src/features/auth/form.ts` (remove `FieldErrors`, `fieldErrors`, `focusFirstError`), `src/features/auth/LoginForm.tsx`, `SignUpForm.tsx`, `PasswordResetForms.tsx` (import them from `#/lib/validation`)

**Interfaces:**
- Produces (from `#/lib/validation`):
  - `interface ValidationFailure { code: "VALIDATION"; message: string; fields: Record<string, string> }`
  - `type WriteResult<T> = { ok: true; data: T } | { ok: false; error: ValidationFailure }`
  - `const CHECK_FIELDS = "Check the highlighted fields."`
  - `const errorMap: z.core.$ZodErrorMap`. It returns "This field is required." for an `invalid_type` issue whose `input` is `undefined`, and "Check this field." otherwise.
  - `parseInput<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; data: z.output<S> } | { ok: false; error: ValidationFailure }`. It calls `schema.safeParse(raw, { error: errorMap })`. Field key: `issue.path.map(String).join(".")`; the first issue per key wins. Root issues (empty path) set `message`, the first one winning; otherwise `message` is `CHECK_FIELDS`.
  - `type FieldErrors<T = unknown> = Partial<Record<(keyof T & string) | (string & {}), string>>`
  - `fieldErrors<S extends z.ZodType>(schema: S, values: unknown): { data: z.output<S>; errors: null } | { data: null; errors: FieldErrors<z.input<S>> }`: `parseInput`, with `errors = error.fields`.
  - `focusFirstError(form: HTMLFormElement | null): void`: moved unchanged.
  - `class Rejected { constructor(readonly error: ValidationFailure) }` and `rejected(message: string, fields: Record<string, string> = {}): Rejected` (decision 4; Tasks 5 and 6 use them).

- [ ] **Step 1: Write the failing unit tests** in `validation.test.ts`. Use `const schema = z.object({ postcode: z.string().min(1, "Enter your postcode."), vehicle: z.object({ registration: z.string().min(1, "Enter the registration.") }), drivers: z.array(z.object({ dateOfBirth: z.iso.date("Enter a date of birth.") })), cover: z.enum(["comprehensive", "third_party"]) })`:
  - `{ postcode: "", vehicle: { registration: "" }, drivers: [{ dateOfBirth: "x" }], cover: "comprehensive" }` → `fields` equals `{ postcode: "Enter your postcode.", "vehicle.registration": "Enter the registration.", "drivers.0.dateOfBirth": "Enter a date of birth." }`, and `message` is `CHECK_FIELDS`.
  - `postcode: z.string().min(1, "first").min(3, "second")` with `""` → `fields.postcode === "first"`.
  - A `.refine(() => false, { message: "Pick a start date after today." })` on the object → `message === "Pick a start date after today."`, `fields` is `{}`.
  - `{}` → `fields.vehicle === "This field is required."`; `cover: "zzz-typed"` → `fields.cover === "Check this field."`.
  - `JSON.stringify(failure)` never contains `"zzz-typed"`, and no message matches `/expected|received|invalid input/i`.
  - Valid input → `{ ok: true, data }` with the parsed value.
  - `fieldErrors(signInSchema, { email: "", password: "" })` gives the same `errors` as before the move (`email: "Enter your email address."`, `password: "Enter your password."`).
  - `rejected("This quote has expired.")` → `.error` equals `{ code: "VALIDATION", message: "This quote has expired.", fields: {} }`.
- [ ] **Step 2: Write the failing component test** in `validation.browser.test.tsx`: a test-only form with two `Input`s (`id="vehicle.registration"` and `id="drivers.0.dateOfBirth"`, `error={errors[id]}`) and a `role="alert"` paragraph showing `message` when `fields` is empty. A button sets `errors` from a hard-coded server `ValidationFailure` and calls `focusFirstError`. Assert: each input has `aria-invalid="true"`; its `aria-describedby` element's text is its message; focus is on `vehicle.registration`. With `{ fields: {}, message: "This quote has expired." }`, the alert shows the sentence and no input is invalid.
- [ ] **Step 3: Run them to see them fail.** Run `vp test --project unit src/lib/validation.test.ts` and `vp test --project component src/lib/validation.browser.test.tsx`. Expected: FAIL (no module).
- [ ] **Step 4: Implement `validation.ts`** and move the auth imports. Comments say: the map is per parse, not `z.config`, because Better Auth shares zod; and a field's own message wins over the map.
- [ ] **Step 5: Run them to see them pass**, plus `vp test --project component src/features/auth` (the auth forms unchanged). Expected: PASS.
- [ ] **Step 6: Commit** — `feat: the shared validation-error contract; auth forms use it`

---

### Task 3: Public error codes, the adapter, `actorMiddleware`

**Files:**
- Modify: `src/server/auth/errors.ts`, `src/server/auth/errors.test.ts`, `src/server/auth/middleware.ts`, `src/start.ts`, `package.json` (devDependency `seroval`, exact version `1.7.1`, the version Start resolves)
- Create: `src/server/auth/middleware.test.ts`

**Interfaces:**
- Produces (from `errors.ts`):
  - `type PublicCode = AuthzCode | "RATE_LIMITED" | "IDEMPOTENCY_CONFLICT" | "INTERNAL"`
  - `class RateLimitError extends Error` (`name "RateLimitError"`, `readonly action: string`, message `rate limited: <action>`)
  - `class IdempotencyConflictError extends Error` (`name "IdempotencyConflictError"`). Both live here rather than in their db modules, because `toPublicError` must map them and `errors.ts` runs in the browser.
  - `toPublicError(error): { status: number; code: PublicCode; message: string }`, mapping the two classes to 429 and 409 with the fixed sentences.
  - `PublicError`: `constructor(error: unknown, pub = toPublicError(error))`, `code: PublicCode`, and `static from(pub: { code: PublicCode; status: number; message: string }): PublicError` (`new PublicError(undefined, pub)`).
  - `publicErrorAdapter = createSerializationAdapter({ key: "kerb/PublicError", test: (v): v is PublicError => v instanceof PublicError, toSerializable: (e) => ({ code: e.code, status: e.status, message: e.message }), fromSerializable: PublicError.from })`, imported from `@tanstack/react-router`.
- Produces (from `middleware.ts`): `actorMiddleware`, which puts `actor: Actor | null` on the context. Like `userMiddleware`, it wraps `next()` in `try` and calls `fail()`.
- `fail()` changes: `RateLimitError` and `IdempotencyConflictError` aren't logged there (`limit()` logs its own refusal; a conflict is a user outcome). `AuthzError` keeps `[authz] <code>`. Everything else keeps `logSafeError`.
- `start.ts`: `serializationAdapters: [publicErrorAdapter]` in `createStart`.

- [ ] **Step 1: Write the failing tests.**
  - In `errors.test.ts`:
    - `toPublicError(new RateLimitError("quote.price"))` → `{ status: 429, code: "RATE_LIMITED", message: "You're going a bit fast. Try again in a minute." }`.
    - `toPublicError(new IdempotencyConflictError())` → 409 with its sentence.
    - `PublicError.from({ code: "FORBIDDEN", status: 403, message: "x" })` is a `PublicError` with those fields.
    - The round trip with `plugins = [makeSerovalPlugin(publicErrorAdapter), ...defaultSerovalPlugins]` (from `@tanstack/react-router/ssr/client`; adapters come first, as Start orders them): `fromJSON(await toCrossJSONAsync({ error: new PublicError(new RateLimitError("a")) }, { refs: new Map(), plugins }), { refs: new Map(), plugins }).error` is a `PublicError` with code `RATE_LIMITED`, status 429 and the sentence. The serialised JSON text doesn't contain `stack` or `cause`. A plain `new Error("secret detail")` comes back as an `Error` that isn't a `PublicError`, with only its message.
  - In `middleware.test.ts`: mock `@tanstack/react-start/server` (`getRequestHeaders: () => new Headers()`) and `./actor` (`getActor` resolves `null`, the rest actual). Then:
    - `userMiddleware.options.server({ next, context: {} } as never)` rejects with a `PublicError` (code `UNAUTHENTICATED`, status 401), and `next` wasn't called.
    - With `actorMiddleware`, `next` receives `{ context: { actor: null } }`.
    - When `next` throws `new RateLimitError("quote.price")`, the call rejects with a `PublicError` (code `RATE_LIMITED`, status 429), and `console.error` wasn't called.
    - When `next` throws `new Error("db detail")`, it rejects with code `INTERNAL`, and the logged value is `{ name: "Error" }`.
  - (This stands in for the spec's integration test against a test-only server function. Vitest doesn't load Start's compiler, so a `createServerFn` can't be called. The middleware is the part that throws, the round trip is the part that crosses, and `resolveErrorStatus` reading `error.status` was checked in the spec. Record this in Results.)
- [ ] **Step 2: Run them to see them fail.** Run `vp test --project unit src/server/auth/errors.test.ts src/server/auth/middleware.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above, and add `seroval` with `pnpm add -D seroval@1.7.1`.
- [ ] **Step 4: Run them to see them pass**, then `vp build`. The build checks that `start.ts` still bundles `errors.ts` for the browser. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: PublicError reaches the browser with its code; RATE_LIMITED, IDEMPOTENCY_CONFLICT and actorMiddleware`

---

### Task 4: `limit()` and `rateLimitSubject()`

**Files:**
- Create: `src/server/db/rate-limit.ts`, `src/server/db/rate-limit.test.ts`, `src/server/db/rate-limit.int.test.ts`

**Interfaces:**
- Consumes: `RateLimitError` (Task 3); `clientIp`, `hashIp` (`request-info.ts`); `getAuthEnv` (`env.ts`).
- Produces:
  - `interface RateRule { max: number; windowSeconds: number }`
  - `limit(key: string, rule: RateRule): Promise<void>`. It throws `RateLimitError(action)`, where `action` is `key` up to its first `:`, and logs `console.warn("[rate-limit]", action)`.
  - `slidingEstimate(previous: number, current: number, elapsedSeconds: number, windowSeconds: number): number` returns `previous * max(0, 1 - elapsedSeconds / windowSeconds) + current`.
  - `rateLimitIp(ip: string): string`. IPv4 comes back unchanged. `::ffff:a.b.c.d` becomes `a.b.c.d`. Other IPv6 is expanded, lowercased, and cut to its first four groups plus `::/64`, for example `2001:db8:0:0::/64`.
  - `rateLimitSubject(actor: Actor | null, headers: Headers, secret = getAuthEnv().BETTER_AUTH_SECRET): Promise<string>`.

- [ ] **Step 1: Write the failing unit tests** in `rate-limit.test.ts`:
  - `slidingEstimate(10, 1, 0, 60) === 11`, `slidingEstimate(10, 1, 30, 60) === 6`, `slidingEstimate(10, 1, 60, 60) === 1`.
  - `rateLimitIp("203.0.113.7") === "203.0.113.7"` and `rateLimitIp("::ffff:203.0.113.7") === "203.0.113.7"`.
  - `2001:DB8::1`, `2001:db8:0:0:1::2` and `2001:0db8:0000:0000:ffff::9` give the same result; `2001:db8:0:1::1` gives a different one. (Review Focus 1.)
  - `rateLimitSubject`: an actor → `user:<id>`; headers with `x-vercel-forwarded-for: 203.0.113.7` → matches `/^ip:[0-9a-f]{64}$/` and doesn't contain `203.0.113.7`; two addresses in one /64 → equal; no IP → `ip:unknown`.
- [ ] **Step 2: Write the failing integration tests** in `rate-limit.int.test.ts`. Use `{ max: 3, windowSeconds: 86400 }` unless stated:
  - Three calls resolve; the fourth rejects with `RateLimitError`.
  - `"a:1"` and `"a:2"` don't affect each other.
  - 20 concurrent calls with `max: 10` → exactly 10 fulfilled.
  - A refused attempt still counts: after the refusal, the row's `count` is 5 after five calls.
  - A previous window, inserted through `tamper()` one window back with `count` 1000 → the first call is refused.
  - The same row two windows back → allowed.
  - `console.warn` was called with `("[rate-limit]", "a")` only.
- [ ] **Step 3: Run them to see them fail** (`vp test --project unit …` and `--project integration …`).
- [ ] **Step 4: Implement.** `limit()` is a single statement through `getDb()`, outside any transaction, built with Drizzle's `sql`:

```sql
with cur as (
  insert into rate_limits (key, window_start, count)
  values (${key}, date_bin(make_interval(secs => ${w}), now(), 'epoch'::timestamptz), 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count, window_start
)
select cur.count as current,
  coalesce((select r.count from rate_limits r
            where r.key = ${key} and r.window_start = cur.window_start - make_interval(secs => ${w})), 0) as previous,
  extract(epoch from now() - cur.window_start)::float8 as elapsed
from cur
```

  Refuse when `slidingEstimate(previous, current, elapsed, w) > max`. A header comment covers: fail closed, refusals count, outside the write's transaction, and the database clock.
- [ ] **Step 5: Run them to see them pass.**
- [ ] **Step 6: Commit** — `feat: limit() Postgres sliding-window rate limiter, guests by IP hash`

---

### Task 5: `withIdempotency`

**Files:**
- Modify: `src/server/audit/chain.ts` (export `JsonValue`, with `AuditValue` kept as an alias; rename `canonical` to an exported `canonicalJson`), `src/server/audit/chain.test.ts`, `src/server/db/tx.ts` (handles `Rejected`), `src/server/db/tx.int.test.ts`, `src/server/db/schema/platform.ts` (the `response` comment becomes "Set in the same transaction as the write; never committed null")
- Create: `src/server/db/idempotency.ts`, `src/server/db/idempotency.test.ts`, `src/server/db/idempotency.int.test.ts`

**Interfaces:**
- Consumes: `withTx`, `Tx` (Task 1); `Rejected` (Task 2); `IdempotencyConflictError` (Task 3).
- Produces:
  - **`withTx`, extended:** when `run` resolves to a `Rejected`, the transaction rolls back (throw a private sentinel inside, catch it outside) and `withTx` resolves to that `Rejected`.
  - **`interface IdempotencyInput { userId: string; key: string; action: string; payload: unknown }`**
  - **`toJson(value: unknown): JsonValue`:** `JSON.parse(JSON.stringify(value))`, with `undefined` → `null`.
  - **`requestHash(action: string, payload: unknown): string`:** 64 hex characters.
  - **`findReplay(db: Db, input: IdempotencyInput): Promise<{ response: JsonValue } | null>`:** it reads the row where `expires_at > now()`. A different hash throws `IdempotencyConflictError`.
  - **`withIdempotency<T extends JsonValue>(db: Db, input: IdempotencyInput, run: (tx: Tx) => Promise<T | Rejected>): Promise<T | Rejected>`.** Inside `withTx` it does three things:
    1. It inserts with `.onConflictDoUpdate({ target: [userId, key], set: { requestHash, response: null, createdAt: sql\`now()\`, expiresAt }, setWhere: sql\`${idempotencyKeys.expiresAt} <= now()\` }).returning(…)`.
    2. No row returned means another request holds the key: select it; a different hash throws `IdempotencyConflictError`, otherwise it returns the stored `response`.
    3. Otherwise it runs. A `Rejected` result is returned (so `withTx` rolls back). Any other result is stored as `toJson(result)` and returned.

- [ ] **Step 1: Write the failing tests.**
  - In `chain.test.ts`: `canonicalJson({ b: 1, a: [true, null] }) === '{"a":[true,null],"b":1}'`.
  - In `tx.int.test.ts`: a `run` that inserts a `jobs` row and returns `rejected("No.")` → resolves to that `Rejected`, with 0 `jobs` rows.
  - In `idempotency.test.ts`:
    - `toJson({ at: new Date("2026-11-05T10:00:00.000Z"), gone: undefined })` equals `{ at: "2026-11-05T10:00:00.000Z" }`.
    - `requestHash("a", { x: 1, y: 2 }) === requestHash("a", { y: 2, x: 1 })`.
    - A different action or payload changes the hash.
  - In `idempotency.int.test.ts`, using `makeCustomer()` for the user, a counter, and a `run` that inserts a `jobs` row with `idempotencyKey: randomUUID()` and returns `{ jobId }`. These are the spec's integration row, each as one `it`:
    - first call runs once
    - repeat → equal result, counter 1
    - other payload → `IdempotencyConflictError`
    - other action → `IdempotencyConflictError`
    - a throwing `run` → 0 key rows, and the retry runs
    - `rejected` → 0 key rows and 0 `jobs` rows, and the retry runs
    - two concurrent calls, with `run` sleeping 200 ms → counter 1, both results equal
    - expired (`tamper` sets `expires_at = now() - interval '1 minute'`) → runs again
    - two users, same key → both run
    - a result `{ at: new Date(...) } as unknown as JsonValue` → `{ at: "<ISO>" }` both times
    - `findReplay`: same request → the response; other → conflict; missing or expired → `null`
    - **An expired key reused with another payload runs fresh, not `IDEMPOTENCY_CONFLICT`.** (Review Focus 3.)
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** A header comment covers: why a plain `INSERT` can't be used (the unique violation aborts the transaction); that the second caller waits on the first's row, bounded by `lock_timeout`; and that responses hold ids and statuses only.
- [ ] **Step 4: Run them to see them pass**, plus `vp test --project unit src/server/audit` (the chain's canonical form is unchanged).
- [ ] **Step 5: Commit** — `feat: withIdempotency, atomic key rows with replay and conflict`

---

### Task 6: `defineWrite`

**Files:**
- Modify: `src/server/data/define.ts`, `src/server/data/permissions.int.test.ts` (the completeness `found` list skips values whose `kind === "write"`)
- Create: `src/server/data/define.int.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (from `define.ts`; `rejected` and `Rejected` re-exported from `#/lib/validation`):
  - `interface WriteOptions { limit?: { action: string; rule: RateRule }; idempotent?: { action: string } }`
  - `interface WriteEnvelope { input: unknown; idempotencyKey?: unknown }`
  - `interface DataWrite<O> { (actor: Actor | null, raw: WriteEnvelope, ctx: { headers: Headers }): Promise<WriteResult<O>>; access: "signed_in"; kind: "write" }`
  - `defineWrite<P, O extends JsonValue>(input: z.ZodType<P>, options: WriteOptions, run: (actor: Actor, data: P, tx: Tx) => Promise<O | Rejected>): DataWrite<O>`
- **The order:**
  1. `requireUser(actor)`.
  2. `parseInput(input, raw.input)`, and for idempotent writes also `parseInput(z.object({ idempotencyKey: z.uuid() }), { idempotencyKey: raw.idempotencyKey })`. Either failing returns `{ ok: false }` with both sets of fields merged and `message` from the input's failure, or `CHECK_FIELDS`.
  3. Idempotent: `findReplay(getDb(), { userId, key, action, payload: data })`; a hit returns `{ ok: true, data: response }`.
  4. `options.limit`: `limit(\`${action}:${await rateLimitSubject(actor, ctx.headers)}\`, rule)`.
  5. `withIdempotency(…)` or `withTx(…)` around `run`. A `Rejected` result returns `{ ok: false, error }`; anything else returns `{ ok: true, data }`.
- Thrown errors leave `defineWrite` unconverted. The server function's `userMiddleware` converts them (spec call 9).

- [ ] **Step 1: Write the failing tests** in `define.int.test.ts`, with a test-only write: `defineWrite(z.object({ title: z.string().trim().min(1, "Enter a title.") }), { limit: { action: "test.write", rule: { max: 2, windowSeconds: 86400 } }, idempotent: { action: "test.write" } }, run)`. The `run` inserts a `jobs` row, calls `audit(tx, { actor, action: "test.written", entityType: "job", entityId })` and returns `{ jobId }`. Also define a non-idempotent twin. Each check is one `it`:
  - `write.access === "signed_in"` and `write.kind === "write"`.
  - A guest → rejects `AuthzError` `UNAUTHENTICATED`, and 0 `rate_limits` rows.
  - `{ title: "" }` → `{ ok: false, error.fields.title: "Enter a title." }`, with 0 `rate_limits` rows and 0 `jobs` rows.
  - No key, or `"not-a-uuid"` → a failure on `fields.idempotencyKey`.
  - Bad title and no key → both fields. (Review Focus 2.)
  - Third call with fresh keys → `RateLimitError`, with no new key row and no new `jobs` row.
  - A replay of the first committed key after the limit is used up → `{ ok: true }` with the same `data`, not `RateLimitError`, and the `rate_limits` count unchanged.
  - `{ title: " Car " }` then `{ title: "Car" }` with one key → the second is a replay (same `data`, one `jobs` row). (Review Focus 5.)
  - A `run` returning `rejected("This quote has expired.")` → `{ ok: false, error.message: "This quote has expired." }`, with 0 `jobs`, key and `audit_log` rows, and a `rate_limits` count of 1.
  - Clean → `{ ok: true }`, with one `jobs` row, one key row (with `response` equal to `data`) and one `audit_log` row.
  - The non-idempotent twin ignores `idempotencyKey` and writes.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**, and add the `kind` filter to `permissions.int.test.ts` with a comment ("writes join the suite in 6.10, decision 7").
- [ ] **Step 4: Run them to see them pass**, plus `vp test --project integration src/server/data`.
- [ ] **Step 5: Commit** — `feat: defineWrite chains access, validation, replay, limit and transaction`

---

### Task 7: The browser half

**Files:**
- Create: `src/lib/writes.ts`, `src/lib/writes.test.ts`, `src/lib/writes.browser.test.tsx`

**Interfaces:**
- Consumes: `PublicError` (Task 3).
- Produces:
  - `useIdempotencyKey(scope: string): { key: string; rotate: () => void }`. The storage key is `kerb:idempotency:<scope>`. The lazy `useState` initialiser reads a stored value only if it matches the UUID pattern; otherwise it makes a fresh `crypto.randomUUID()` and stores it. Every `sessionStorage` access is in try/catch, falling back to memory.
  - `type WriteOutcome = { kind: "sign_in" } | { kind: "message"; message: string; rotateKey: boolean }`
  - `writeOutcome(error: unknown): WriteOutcome`: `UNAUTHENTICATED` → `sign_in`; `IDEMPOTENCY_CONFLICT` → message with `rotateKey: true`; any other `PublicError` → its message, `rotateKey: false`; a non-`PublicError` → "Something went wrong. Please try again.", `rotateKey: false`.

- [ ] **Step 1: Write the failing tests.**
  - In `writes.test.ts`: each `writeOutcome` case, built with `PublicError.from`.
  - In `writes.browser.test.tsx`, using `renderHook`:
    - the same key across `rerender` and across unmount and remount with one scope
    - two scopes get different keys
    - after `rotate()` the key changes and a remount reads the new one
    - with `vi.spyOn(Storage.prototype, "getItem")` and `setItem` throwing, it still returns a UUID and `rotate()` still works
    - a stored `"not-a-uuid"` is replaced by a UUID (Review Focus 4)
    - `sessionStorage.clear()` in `afterEach`
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** The header comment says: rotate after a success and after a conflict; keep the key after a network failure; and the key survives the sign-in redirect because it's the same tab.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit** — `feat: useIdempotencyKey and writeOutcome for forms`

---

### Task 8: Docs, Results, final checks

**Files:**
- Modify: `plan/engineering.md`, `plan/phases/04-data-auth/phase.md`, `plan/build-plan.md`, `plan/phases/04-data-auth/05c-safe-write-tools.md`

- [ ] **Step 1: Update `engineering.md`:**
  - **§8, Transactions:** the path stays `src/server/db/tx.ts`; add the timeouts, the source-scan rule and that a `rejected` result rolls back.
  - **§8, Idempotency:** the row commits with the write, replay before limit, a conflict is 409, and the key lifecycle (`useIdempotencyKey`).
  - **§9, Errors and logs:** `PublicError` crosses with its code through the adapter; every server function uses `userMiddleware`, `permissionMiddleware` or `actorMiddleware`; no zod `inputValidator` on writes; validation failures and rejections are returned and not logged.
  - **§10:** the path becomes `src/server/db/rate-limit.ts`, built in 4.5c (not 4.5). Add guests by keyed IP hash with IPv6 by /64, and that the first caller creates `rate-limit-rules.ts`.
- [ ] **Step 2: Mark the trackers.** In `phase.md`, the 4.5c row becomes done (summary as built), and its testing row is updated. In `build-plan.md`, the 4.5c line is ticked.
- [ ] **Step 3: Write the spec's Results.** Add a `## Results` section in the 4.5 and 4.5b style: changes from the spec, what was built, the test counts from `vp test`, and still to do (the staging check of sign-in linking and the staff reads). Changes to record:
  - The middleware unit test stands in for the server-function integration test (Task 3).
  - `RateLimitError` and `IdempotencyConflictError` live in `errors.ts`.
  - `Rejected` lives in `src/lib/validation.ts`.
  - The completeness check's write filter is covered by `define.int.test.ts`'s `kind` assertion.
  - The `seroval` devDependency, kept on Start's version. Dependabot bumps of Start need it to follow.
- [ ] **Step 4: Run the full checks.** `vp check`, `vp test` (all three projects) and `vp build`. Expected: all pass, with no new warnings.
- [ ] **Step 5: Commit** — `docs: 4.5c results, engineering.md §8–§10, trackers`
