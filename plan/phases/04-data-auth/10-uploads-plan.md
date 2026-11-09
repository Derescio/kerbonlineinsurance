# 4.10 Upload foundation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers' files go from the browser straight to a private R2 bucket on 5-minute signed links. Photos are resized and re-encoded first (no EXIF, no GPS). The server checks each file's first bytes, who owns it and who may see it, and a daily job cleans up. `/dev/uploads` proves it from a laptop and a phone.

**Architecture:** There are four layers.
1. **Pure modules** in `src/server/uploads/`: limits, object keys and magic bytes. The browser imports the limits too.
2. **`ObjectStore`:** an interface with an R2 implementation (AWS SDK v3, server-only) and an in-memory fake for the integration tests.
3. **The data layer** in `src/server/data/files.ts`: protected reads (`defineRead`) and writes (`defineWrite`). Its raw row helpers live in `src/server/data/file-rows.ts`, which the permission suite skips, for the account hooks and the cleanup.
4. **The browser:** `src/features/uploads/client.ts` (canvas resize and re-encode, XHR `PUT` with progress) and the `/dev/uploads` page on server functions.

**Tech Stack:** TypeScript, Drizzle, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (new), Vitest `unit`, `integration` and `component` (Chromium) projects, TanStack Start server functions and file routes.

**Spec:** [10-uploads.md](10-uploads.md). Read calls 5–18 and "The test page" before starting.

## Global Constraints

- **Kinds:** `claim_photo`, `claim_document`, `review_photo` only. Statuses: `pending`, `ready`, `rejected`, `deleted`.
- **Limits:**
  - **Before resize, in the browser:** 10 MB for every kind.
  - **What the server signs:** 4 MB for a resized image or a thumbnail, 10 MB for a PDF.
  - **Counts:** 10 photos per claim, 5 documents per claim, 3 photos per review. `pending` and `ready` both count.
- **Images:** at most 2048 px on the long side, and a thumbnail 400 px wide. Input types: JPEG, PNG, WebP, HEIC/HEIF.
- **Links:** every signed `PUT` and `GET` expires in 300 s. A `PUT` link signs `content-type` and `content-length`.
- **Object keys:** `{kind}/{userId}/{fileId}.{ext}`, plus `{kind}/{userId}/{fileId}-thumb.{ext}` for an image.
- **Uploads allowed:** a claim in `draft`, `received`, `assessing` or `approved`, by its own customer. A review in `pending`, by its own customer. Anything else that isn't theirs is `NOT_FOUND`.
- **Removal (`deleteMyFile`):** only on a `draft` claim or a `pending` review.
- **Rate limit:** `createUpload` goes through `limit("upload.create:<subject>", { max: 60, windowSeconds: 3600 })`.
- **Audit:** a new action `file.viewed`, entity type `file`, written by staff views only.
- **R2:** `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, path-style, region `auto`, `requestChecksumCalculation: "WHEN_REQUIRED"` (otherwise the SDK adds a CRC32 the browser can't send).
- **Never stored:** the original filename. Never logged: object keys and user ids.
- **Exact copy:**
  - "This claim already has 10 photos."
  - "This claim already has 5 documents."
  - "This review already has 3 photos."
  - "That file isn't a photo."
  - "That file isn't a PDF."
  - "That file is too big. The limit is 10 MB."
  - "This claim can't take new files."
  - "This review can't take new photos."
  - "Files can only be removed from a draft claim or a pending review."
  - "We didn't receive that file. Please try again."
  - "This photo's format isn't supported here. Try saving it as a JPEG."
- **Process:** stage files by name. No browser tests or `vp build` while Damion's `vp dev` is running without telling him first.

## Calls this plan makes (for Damion to check)

- **P1. `owner_user_id` is `keep`, not hashed.** `data-contract.test.ts` (review H2) requires every copied user-id column to be treated the same way, as `keep`. A user id is a pseudonym once names and emails are dropped. Hashing it here would fail that test and break joins in Phase 9. The object keys hold the same id, so they are `keep` too.
- **P2. Split reads, as 4.5 does.**
  - **Customers:** `getMyFileUrl` and `listMyClaimFiles`.
  - **Staff:** `staffGetFileUrl` and `staffListClaimFiles`.
  - **Why:** the spec's single `getFileUrl` would need two access rules on one read, and the permission suite checks one `access` per read. A staff list returns metadata only and writes no audit row; opening a file is what writes `file.viewed`.
- **P3. A JPEG fallback for Safari.** Safari decodes WebP but its canvas can't encode it, so `toBlob("image/webp")` gives back PNG.
  - **What happens:** the client then encodes a JPEG instead. Canvas output carries no EXIF, so GPS still goes.
  - **What the server accepts:** `image/webp` or `image/jpeg` for image kinds, and the key ends `.jpg`.
  - **Effect on the check:** on an iPhone the manual check's file will be a JPEG ≤ 2048 px with no GPS, not a WebP.
- **P4. A `purged_at` column** records when a row's objects were deleted from R2. The cleanup's "deleted rows whose object is still there" is `purged_at is null`. Rows are never deleted.
- **P5. Closure doesn't delete objects itself.** `closeAccountRows` marks the files of draft claims and of reviews `deleted`, and the next daily cleanup deletes the objects.
- **P6. `vp run uploads:check-r2`.** A small script for the manual R2 check. It puts, heads, reads, signs a GET and deletes one object in the bucket from `.env.local`.

## Review Focus

1. **Two tabs racing for the 10th photo.** `createUpload` locks the parent row (`FOR NO KEY UPDATE`) before counting, so the second request waits and then sees 10. Test in Task 5: run two `createUpload` calls with `Promise.all` on a claim that has 9 files; exactly one succeeds.
2. **Confirm called twice, or after the cleanup.** A second `confirmUpload` on a `ready` file returns `{ status: "ready" }` without reading R2. A `deleted` or `rejected` file is returned as it stands, never revived. Test in Task 5.
3. **A file whose parent changed after upload.** A claim settled or a review published after a photo went up: `getMyFileUrl` still works (the evidence is the customer's), and `deleteMyFile` refuses it. Test in Task 6.
4. **R2 down during the immediate delete.** The rows still commit as `deleted` with `purged_at` null, and the cleanup finds them later. Test in Task 7: a store whose `delete` throws.
5. **A staff list or URL on a review photo, or on a `pending`/`rejected` file.** It's `NOT_FOUND`, with no audit row. Test in Task 6.

---

## File structure

| File | Responsibility |
|---|---|
| `src/server/db/schema/values.ts` | `fileKinds`, `fileStatuses`, `fileMimes` |
| `src/server/uploads/limits.ts` (+ `.test.ts`) | per-kind limits, accepted input types, copy, `checkUpload()` |
| `src/server/uploads/keys.ts` (+ `.test.ts`) | `objectKey`, `thumbKey`, `extensionFor` |
| `src/server/uploads/magic.ts` (+ `.test.ts`) | `detectType(bytes)` |
| `src/server/uploads/store.ts` | `ObjectStore` interface, `getObjectStore`, `setObjectStore` |
| `src/server/uploads/store-memory.ts` (+ `.test.ts`) | `MemoryObjectStore` |
| `src/server/uploads/store-r2.ts` (+ `.test.ts`) | `R2ObjectStore` |
| `src/server/uploads/cleanup.ts` (+ `.int.test.ts`) | `runUploadsCleanup(db, store, now)` |
| `src/server/env.ts` (+ test) | `getR2Env()`, `R2ConfigError` |
| `src/server/security-headers.ts` (+ test), `src/start.ts` | R2 origin in `connect-src`/`img-src`, `blob:` in `img-src` |
| `src/server/db/schema/files.ts`, `index.ts`, `relations.ts` | `files` table |
| `drizzle/0016_*.sql`, `drizzle/0017_files_triggers.sql` | generated table and hand-written triggers |
| `src/server/db/data-contract.ts` | `files` entry |
| `src/server/audit/actions.ts` (+ snapshot) | `file.viewed` |
| `src/server/data/files.ts` (+ `files.int.test.ts`) | `createUpload`, `confirmUpload`, `deleteMyFile`, the four reads |
| `src/server/data/file-rows.ts` | `deleteUserFiles`, `markClosureFiles`, `filesToPurge`, `markPurged` |
| `src/server/data/index.ts`, `permissions.int.test.ts` | the four reads in the suite; `file-rows.ts` skipped |
| `src/server/account/files.ts`, `delete.ts`, `src/server/data/account.ts` | the 4.7 hooks filled in |
| `src/server/cron-auth.ts` (+ `.test.ts`) | `isCronAuthorized(header, secret)`, shared by both cron routes |
| `src/routes/api/cron/uploads-cleanup.ts` (+ `-uploads-cleanup.int.test.ts`) | the cron route |
| `scripts/uploads-cleanup.ts`, `scripts/r2-check.ts`, `package.json`, `vercel.json` | `uploads:cleanup`, `uploads:check-r2`, the cron |
| `src/test/factories.ts`, `src/test/world.ts` | `makeReview`, `makeFile`; a ready file on claim A |
| `src/features/uploads/client.ts` (+ `client.browser.test.tsx`) | `prepareImage`, `uploadFile` |
| `src/features/uploads/server.ts` | the test page's server functions |
| `src/features/uploads/UploadsTestPage.tsx` (+ `.browser.test.tsx`), `src/routes/dev.uploads.tsx` | `/dev/uploads` |
| `plan/engineering.md` §6, §9; `plan/dev-database.md`; `.env.example` | docs |

---

### Task 1: Limits, keys and magic bytes

**Files:**
- Modify: `src/server/db/schema/values.ts`
- Create: `src/server/uploads/limits.ts`, `keys.ts`, `magic.ts`, each with a `.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // values.ts
  export const fileKinds = ["claim_photo", "claim_document", "review_photo"] as const;
  export type FileKind = (typeof fileKinds)[number];
  export const fileStatuses = ["pending", "ready", "rejected", "deleted"] as const;
  export type FileStatus = (typeof fileStatuses)[number];
  export const fileMimes = ["image/webp", "image/jpeg", "application/pdf"] as const;
  export type FileMime = (typeof fileMimes)[number];

  // limits.ts (no server imports: the browser uses it)
  export const MB = 1024 * 1024;
  export const LINK_SECONDS = 300;
  export const IMAGE_MAX_PX = 2048, THUMB_WIDTH = 400;
  export const ORIGINAL_MAX_BYTES = 10 * MB;
  export interface KindLimit { parent: "claim" | "review"; image: boolean; mimes: readonly FileMime[]; maxBytes: number; maxCount: number; countMessage: string; typeMessage: string }
  export const KIND_LIMITS: Record<FileKind, KindLimit>;   // images: mimes webp+jpeg, maxBytes 4 MB; document: pdf, 10 MB
  export const IMAGE_INPUT_TYPES: readonly string[];        // image/jpeg, image/png, image/webp, image/heic, image/heif
  export const UPLOAD_COPY: { tooBig; claimClosed; reviewClosed; removeRefused; notReceived; heic };  // the Global Constraints sentences
  export function checkUpload(kind: FileKind, mime: string, bytes: number): string | null; // null = fine, else the sentence

  // keys.ts
  export function extensionFor(mime: FileMime): "webp" | "jpg" | "pdf";
  export function objectKey(kind: FileKind, userId: string, fileId: string, mime: FileMime): string;
  export function thumbKey(kind: FileKind, userId: string, fileId: string, mime: FileMime): string;

  // magic.ts
  export type Detected = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;
  export function detectType(bytes: Uint8Array): Detected;  // needs the first 12 bytes
  export const MAGIC_BYTES = 16;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `checkUpload("claim_photo", "image/webp", 4*MB)` → null.
  - `checkUpload("claim_photo", "image/webp", 4*MB+1)` → `tooBig`.
  - `checkUpload("claim_document", "image/webp", 10)` → "That file isn't a PDF."
  - `checkUpload("claim_photo", "application/x-msdownload", 10)` → "That file isn't a photo."
  - `checkUpload(_, _, 0)` → `tooBig`.
  - `KIND_LIMITS.claim_photo.maxCount === 10`, `claim_document` 5, `review_photo` 3. The `countMessage` strings match the copy.
  - `objectKey("claim_photo","u1","f1","image/webp")` → `"claim_photo/u1/f1.webp"`. `thumbKey(...)` → `"claim_photo/u1/f1-thumb.webp"`. `"image/jpeg"` gives `.jpg`, and `"application/pdf"` gives `.pdf`.
  - `detectType`:
    - `FF D8 FF E0…` → JPEG.
    - `89 50 4E 47 0D 0A 1A 0A` → PNG.
    - `RIFF????WEBP` → WebP.
    - `%PDF-` → PDF.
    - `MZ` (a renamed `.exe`) → null.
    - `<!DOCTYPE html>` and `<html>` → null.
    - `RIFF????WAVE` → null.
    - Fewer than 4 bytes → null.
- [ ] **Step 2:** `vp test --project unit src/server/uploads`. Expected: FAIL (modules not found).
- [ ] **Step 3:** Implement the three modules and the values.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit the seven files: `feat: upload limits, object keys and magic-byte detection`.

---

### Task 2: `ObjectStore`, the fake, R2 and its env

**Files:**
- Modify: `package.json` + `pnpm-lock.yaml` (`pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`), `src/server/env.ts`, `src/server/env.test.ts`, `.env.example` (comment on the R2 block)
- Create: `src/server/uploads/store.ts`, `store-memory.ts` (+ test), `store-r2.ts` (+ test)

**Interfaces:**
- Produces:
  ```ts
  export interface ObjectStore {
    presignPut(key: string, opts: { contentType: string; contentLength: number }): Promise<string>;
    presignGet(key: string, opts?: { contentType?: string }): Promise<string>;
    head(key: string): Promise<{ size: number; contentType: string | null } | null>; // null when missing
    readFirstBytes(key: string, count: number): Promise<Uint8Array>;
    delete(key: string): Promise<void>;                                              // missing is fine
  }
  export function getObjectStore(): ObjectStore;              // the override, else a memoised R2ObjectStore(getR2Env())
  export function setObjectStore(store: ObjectStore | null): void;  // tests
  export class MemoryObjectStore implements ObjectStore {
    put(key: string, bytes: Uint8Array, contentType: string): void;  // what the browser's PUT would do
    has(key: string): boolean;
    keys(): string[];
    failDeletes: boolean;   // Review Focus 4
  }
  export class R2ObjectStore implements ObjectStore { constructor(env: R2Env) }
  // env.ts
  export interface R2Env { R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; R2_BUCKET: string }
  export class R2ConfigError extends Error {}  // message names the variables, never values
  export function getR2Env(source?: Record<string, string | undefined>): R2Env; // trimmed; R2_ACCOUNT_ID /^[0-9a-f]{32}$/
  export function r2Origin(accountId: string): string;  // https://<id>.r2.cloudflarestorage.com
  ```
- **The fake's URLs:** `memory://put/<key>` and `memory://get/<key>`, so a test can assert which key was signed.

- [ ] **Step 1: Write the failing tests.**
  - **Env:** `getR2Env({})` throws `R2ConfigError`, and the message mentions `R2_ACCOUNT_ID` and "Uploads (4.10)". A valid set is trimmed. A secret's value never appears in the message.
  - **R2** (offline, fake credentials, account `"a".repeat(32)`, bucket `kerb-dev`):
    - `presignPut("claim_photo/u/f.webp", { contentType: "image/webp", contentLength: 1234 })` gives a URL starting `https://aaaa…a.r2.cloudflarestorage.com/kerb-dev/claim_photo/u/f.webp?`.
    - The URL has `X-Amz-Expires=300`, and `X-Amz-SignedHeaders` includes `content-length`, `content-type` and `host`.
    - The URL has no `x-amz-checksum` or `x-amz-sdk-checksum` parameter.
    - `presignGet` has `X-Amz-Expires=300`.
  - **Fake:** `put` then `head` gives the size; `readFirstBytes(k, 4)` gives the first 4 bytes; `delete` then `head` is null; deleting a missing key resolves.
- [ ] **Step 2:** `vp test --project unit src/server/uploads src/server/env.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **The client:** `R2ObjectStore` builds one `S3Client({ region: "auto", endpoint: r2Origin(id), forcePathStyle: true, credentials, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" })`.
  - **Signing a `PUT`:** `getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: LINK_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) })`. If the test shows the headers unsigned, add them to `unhoistableHeaders` too.
  - **Reading the first bytes:** `GetObject` with `Range: bytes=0-<count-1>`, then `transformToByteArray()`.
  - **`head`:** maps `NotFound` / a 404 status to null.
  - **`getR2Env`:** reads on use, like `getCronSecret`.
- [ ] **Step 4:** Run again. Expected: PASS. Then run `vp check` (the new SDK must type-check under TS 7).
- [ ] **Step 5:** Commit: `feat: object store interface, an in-memory fake and the R2 store with 5-minute signed links`.

---

### Task 3: CSP origins

**Files:**
- Modify: `src/server/security-headers.ts` (+ test), `src/start.ts`

**Interfaces:**
- Consumes: `r2Origin` (Task 2). Import it from a tiny `src/server/uploads/origin.ts` if pulling `env.ts` into `security-headers.ts` breaks `vite.config.ts` (which imports `security-headers.ts` at config time).
- Produces: `contentSecurityPolicy(nonce: string, posthogHost?: string, r2AccountId?: string)`.

- [ ] **Step 1: Write the failing tests.**
  - With `r2AccountId = "a".repeat(32)`: `connect-src` and `img-src` each contain `https://aaaa…a.r2.cloudflarestorage.com`, and `img-src` contains `blob:`.
  - Without it: neither list contains `r2.cloudflarestorage.com`, and `img-src` still has `blob:`.
  - A malformed id (`"x"`, `"*"`) adds nothing.
  - No `*.r2.cloudflarestorage.com` wildcard ever.
- [ ] **Step 2:** `vp test --project unit src/server/security-headers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `start.ts` passes `process.env.R2_ACCOUNT_ID`.
  - Fix the `Permissions-Policy` comment: it now says camera stays off because the file picker doesn't need it (call 16).
  - Fix the header comment, which says "Later phases add R2".
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: CSP allows this environment's R2 origin and blob: previews`.

---

### Task 4: `files` table, migration, contract, audit action, factories

**Files:**
- Create: `src/server/db/schema/files.ts`, `drizzle/0016_<generated>.sql`, `drizzle/0017_files_triggers.sql`
- Modify: `schema/index.ts`, `schema/relations.ts`, `data-contract.ts`, `audit/actions.ts`, the snapshot, `src/test/factories.ts`

**Interfaces:**
- Produces:
  ```ts
  export const files = pgTable("files", {
    id: id(),
    ownerUserId: text().references(() => users.id, { onDelete: "set null" }),
    kind: text().notNull(),
    claimId: uuid().references(() => claims.id, { onDelete: "set null" }),
    reviewId: uuid().references(() => reviews.id, { onDelete: "set null" }),
    status: text().notNull().default("pending"),
    objectKey: text().notNull().unique("files_object_key_unique"),
    thumbKey: text(),
    mime: text().notNull(),
    sizeBytes: integer().notNull(),
    width: integer(), height: integer(),
    confirmedAt: timestamp({ withTimezone: true }),
    purgedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(), updatedAt: updatedAt(),
  }, …);
  // AUDIT_ACTIONS
  "file.viewed": { entityType: "file", description: "A staff member opened a claim file" }
  // factories
  export async function makeReview(overrides?: Insert<typeof reviews>): Promise<Review>;  // pending, on a new policy unless given
  export async function makeFile(overrides: Insert<typeof files> & { claimId?: string; reviewId?: string }): Promise<File>;
  // ready claim_photo by default; looks up the parent's customer's user for ownerUserId; keys from objectKey/thumbKey
  ```
- **Checks:**
  - `files_kind_check` and `files_status_check` (`oneOf`).
  - `files_mime_check`.
  - `files_size_check`: `size_bytes > 0`.
  - `files_parent_check`: `status = 'deleted' or (kind in ('claim_photo','claim_document') and claim_id is not null and review_id is null) or (kind = 'review_photo' and review_id is not null and claim_id is null)`.
  - `files_ready_check`: `(status = 'ready') = (confirmed_at is not null) or status in ('deleted','rejected')`.
- **Indexes:** `claim_id`, `review_id`, `owner_user_id`, `(status, created_at)`, `updated_at`.
- **Triggers** (`vp exec drizzle-kit generate --custom --name files_triggers`): `files_set_updated_at` and `files_record_delete` (`record_delete('id')`), worded like 0013.
- **Contract:** grain "one uploaded file's metadata (4.10)", mutable, copied, `changeColumn: "updated_at"`, every column `keep` (call P1).

- [ ] **Step 1: Write the failing tests.**
  - `actions.test.ts`: add `file.viewed` → entity type `file`, then `vp test -u` the snapshot once the code is in.
  - `data-contract.test.ts` and `constraints.int.test.ts` already cover a new table. They fail until the contract entry and the triggers exist.
- [ ] **Step 2:** Add the schema file. Run `vp run db:generate`, then the custom migration. Run `vp run db:test:up`, then `vp test --project unit src/server/db src/server/audit` and `vp test --project integration src/server/db`. Expected: FAIL on the contract and the triggers.
- [ ] **Step 3:** Add the contract entry, the triggers SQL, the audit action, relations (`files` → owner, claim, review) and the factories.
- [ ] **Step 4:** Run again. Expected: PASS. `vp run db:check` is clean.
- [ ] **Step 5:** Commit the schema, both migrations and `meta/`, contract, actions and snapshot, factories: `feat: files table for upload metadata, in the data contract, and the file.viewed audit action`.

---

### Task 5: Writes: `createUpload`, `confirmUpload`, `deleteMyFile`

**Files:**
- Create: `src/server/data/files.ts`, `src/server/data/files.int.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4; `defineWrite`, `rejected`; `OPEN_CLAIM_STATUSES`.
- Produces:
  ```ts
  export const UPLOAD_RULE = { max: 60, windowSeconds: 3600 };
  export interface CreateUploadInput {
    kind: FileKind; parentId: string /* uuid */; mime: FileMime; sizeBytes: number;
    thumbSizeBytes?: number /* required for image kinds */; width?: number; height?: number;
  }
  export interface UploadTicket {
    fileId: string; expiresInSeconds: number;
    upload: { url: string; contentType: string };
    thumbUpload: { url: string; contentType: string } | null;
  }
  export const createUpload: DataWrite<UploadTicket>;   // limit { action: "upload.create", rule: UPLOAD_RULE }; not idempotent
  export const confirmUpload: DataWrite<{ fileId: string; status: FileStatus; message: string | null }>;  // input { fileId }
  export const deleteMyFile: DataWrite<{ fileId: string; status: "deleted" }>;                          // input { fileId }
  ```
- **`createUpload`, in order:**
  1. The zod input (any failure → VALIDATION).
  2. `checkUpload` (a sentence → `rejected`). An image kind without `thumbSizeBytes`, or a thumbnail over 4 MB → `tooBig`.
  3. No `actor.customerId` → `AuthzError("NOT_FOUND")`.
  4. Lock the parent: `select … for no key update` where `id = parentId and customer_id = actor.customerId`. Missing → `NOT_FOUND`.
  5. Parent status not allowed → `claimClosed` / `reviewClosed`.
  6. Count `pending` + `ready` files of that kind on the parent; at `maxCount` → `countMessage`.
  7. Insert the row with the id from `crypto.randomUUID()` (the key needs it before insert) and the keys from Task 1.
  8. Presign one `PUT`, plus one for the thumbnail when it's an image.
- **`confirmUpload`:**
  - Select the row `for update` where `id` and `owner_user_id = actor.userId`. Missing → `NOT_FOUND`.
  - Status not `pending` → return it as is.
  - `head(objectKey)` null (or the thumbnail's null) → `rejected(notReceived)`. The row stays `pending`.
  - `detectType(readFirstBytes(key, MAGIC_BYTES))` must equal `mime`, and the thumbnail's must equal it too. Otherwise delete both objects, then set `rejected` and `purged_at = now()`, and return `{ status: "rejected", message: typeMessage }` as `ok: true`, so the update commits.
  - On a match: `ready`, `confirmed_at = now()`.
- **`deleteMyFile`:**
  - Same row lookup as confirm.
  - The parent must be a `draft` claim or a `pending` review, else `rejected(removeRefused)`. Already `deleted` → return it.
  - Set `deleted`, then try `store.delete` on both keys. On success set `purged_at`. On failure leave it null for the cleanup, which logs the error name only.
- The store is `getObjectStore()`, read inside `run`.

- [ ] **Step 1: Write the failing tests** (`truncateAll`, `setObjectStore(new MemoryObjectStore())`, env stubbed as in `account.int.test.ts` for `rateLimitSubject`). The actors come from `resolveActor`.
  - **createUpload refuses:**
    - an unknown kind (VALIDATION);
    - `mime: "application/pdf"` for `claim_photo` ("That file isn't a photo.");
    - `sizeBytes` 4 MB + 1 (`tooBig`);
    - an 11th photo (10 `makeFile`s, half `pending`) and a 6th PDF;
    - customer B on A's claim (`NOT_FOUND`);
    - a `settled` claim and a `declined` one (`claimClosed`);
    - a `published` review (`reviewClosed`);
    - staff with no customer row (`NOT_FOUND`).
  - **createUpload succeeds:** on a `draft` claim, an `assessing` claim and a `pending` review. It writes one `pending` row with the right keys, and the ticket's URLs are `memory://put/claim_photo/<userId>/<fileId>.webp` and `…-thumb.webp`. A PDF has `thumbUpload: null`.
  - **Rate limit:** 60 calls on a settled claim are each refused, and the 61st throws `RateLimitError`.
  - **Race (Review Focus 1):** 9 files, two calls at once, exactly one `ok`.
  - **confirmUpload:**
    - Real JPEG bytes → `ready` with `confirmed_at` set. The same holds for WebP (`RIFF…WEBP`) and PDF.
    - `MZ…` bytes under a `.webp` key → `rejected`, both objects gone, `purged_at` set.
    - Nothing put → VALIDATION `notReceived`, still `pending`.
    - Customer B confirming A's file → `NOT_FOUND`.
    - A second confirm → `ready` with no store read (spy on `readFirstBytes`) (Review Focus 2).
  - **deleteMyFile:**
    - Works on a draft claim's file and on a pending review's.
    - Refuses a `received` claim's file and a published review's.
    - B → `NOT_FOUND`.
    - With `failDeletes`, the row is `deleted` and `purged_at` is null.
- [ ] **Step 2:** `vp test --project integration src/server/data/files.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: createUpload, confirmUpload and deleteMyFile with ownership, limits and the content check`.

---

### Task 6: Reads, and the permission suite

**Files:**
- Modify: `src/server/data/files.ts`, `files.int.test.ts`, `index.ts`, `permissions.int.test.ts`, `src/test/world.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FileView { id: string; kind: FileKind; status: FileStatus; mime: FileMime; sizeBytes: number; width: number | null; height: number | null; createdAt: Date }
  export interface FileLink { fileId: string; url: string; thumbUrl: string | null; mime: FileMime; expiresInSeconds: number }
  export const listMyClaimFiles: DataRead<{ claimId: string }, (FileView & { thumbUrl: string | null })[]>;     // signed_in; not deleted; thumbUrl for ready images
  export const getMyFileUrl: DataRead<{ fileId: string }, FileLink>;                                                // signed_in; own + ready
  export const staffListClaimFiles: DataRead<{ reference: string }, { claimId: string; reference: string; files: FileView[] }>; // claims.read_all; assertNoConflict; no audit
  export const staffGetFileUrl: DataRead<{ fileId: string }, FileLink>;   // claims.read_all; claim kinds, ready; assertNoConflict; file.viewed in one withTx
  ```
- **Reference input:** `staffListClaimFiles` takes `reference` matching `/^KRB-C-[0-9]{5}$/`.
- **Audit:** `staffGetFileUrl`'s audit row is `{ action: "file.viewed", entityId: fileId, changes: { claimId } }`.
- **The suite:**
  - `buildWorld` gains `records.fileA = await makeFile({ claimId: claimA.id })`.
  - Four `cases` rows, owner `"A"` except the lists (`listMyClaimFiles` takes `claimA`, owner `"A"`; `staffListClaimFiles` takes `claimA.reference`, owner `"A"`).
  - The completeness glob gains `"!./file-rows.ts"`.
  - The suite's `beforeEach` sets a `MemoryObjectStore`.

- [ ] **Step 1: Write the failing tests.**
  - The completeness test fails first: the reads aren't indexed yet.
  - In `files.int.test.ts`:
    - The owner gets a link, `memory://get/<key>`.
    - B gets `NOT_FOUND` for A's file.
    - A `pending` file and a `rejected` one are `NOT_FOUND` to `getMyFileUrl`.
    - A settled claim's ready file still opens (Review Focus 3).
    - A handler opening a claim file writes one `file.viewed` row with `actorRole: "claims_handler"`, and `verifyAuditChain` is ok.
    - The admin-customer gets `CONFLICT_OF_INTEREST` on their own claim's file, and no row.
    - The deactivated handler gets `FORBIDDEN`.
    - A review photo and a `pending` file are `NOT_FOUND` to staff, with no row (Review Focus 5).
    - `staffListClaimFiles` writes no audit row, and an unknown reference is `NOT_FOUND`.
- [ ] **Step 2:** Run `vp test --project integration src/server/data`. Expected: FAIL.
- [ ] **Step 3:** Implement, export from `index.ts`, and add the cases.
- [ ] **Step 4:** Run again. Expected: PASS (the whole data folder, the suite included).
- [ ] **Step 5:** Commit: `feat: owner and staff file reads with signed links, audited staff views, in the permission suite`.

---

### Task 7: The account hooks

**Files:**
- Create: `src/server/data/file-rows.ts`, `src/server/data/file-rows.int.test.ts`
- Modify: `src/server/account/files.ts`, `delete.ts`, `account.int.test.ts` (the spy now returns `[]`), `src/server/data/account.ts` (`closeAccountRows`), `run-closures.int.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // file-rows.ts (plain helpers, not protected reads)
  export async function deleteUserFiles(tx: Tx, userId: string): Promise<string[]>;
  // every not-purged row of the user's → deleted; returns object and thumb keys
  export async function markClosureFiles(tx: Tx, customerId: string): Promise<number>;
  // files on the customer's draft claims and on their reviews → deleted
  export async function markPurged(db: Db | Tx, keys: { ids?: string[]; objectKeys?: string[] }): Promise<void>;
  export async function filesToPurge(db: Db, now: Date, max: number): Promise<{ id: string; status: FileStatus; objectKey: string; thumbKey: string | null }[]>;
  // pending older than 24 h, or rejected/deleted with purged_at null
  // account/files.ts
  export async function deleteUserFiles(tx: Tx, userId: string): Promise<string[]>;  // forwards to file-rows
  export async function purgeObjects(keys: string[]): Promise<void>;  // store.delete each; markPurged; logs the error name on failure
  ```
- **`delete.ts`:** `const keys = await filesHook.deleteUserFiles(tx, userId)` stays in the transaction. After it commits: `if (keys.length) deps.defer(filesHook.purgeObjects(keys))`, next to the email.
- **`closeAccountRows`:** calls `markClosureFiles(tx, customerId)` before it deletes the reviews and draft claims.

- [ ] **Step 1: Write the failing tests.**
  - **Immediate delete:** a user with a draft claim's file (built with `makeFile` directly on the user, since an immediate-delete user has no policy) is deleted. Afterwards the row is `deleted`, `owner_user_id` is null, both objects are gone after `flush()`, and `purged_at` is set.
  - **Rolled back:** `deleteUserFiles` inside a `withTx` that then throws leaves the rows `ready` and the objects present.
  - **R2 down (Review Focus 4):** with `failDeletes`, the delete still succeeds and the row is `deleted` with `purged_at` null.
  - **Closure (`run-closures.int.test.ts`):** a closed account's submitted-claim file stays `ready`. Its draft-claim file and its review photo become `deleted` with no parent.
- [ ] **Step 2:** Run `vp test --project integration src/server/account src/server/data/file-rows.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again, then the whole `vp test --project integration`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: account delete removes the user's files after commit; closure drops draft-claim and review files`.

---

### Task 8: Cleanup job, cron route, scripts

**Files:**
- Create: `src/server/uploads/cleanup.ts` (+ `.int.test.ts`), `src/server/cron-auth.ts` (+ `.test.ts`), `src/routes/api/cron/uploads-cleanup.ts` (+ `-uploads-cleanup.int.test.ts`), `scripts/uploads-cleanup.ts`, `scripts/r2-check.ts`
- Modify: `src/routes/api/cron/account-closures.ts` (use `isCronAuthorized`), `vercel.json`, `package.json`, `src/server/data/account.ts` or `file-rows.ts` (`uploadsDb()`, as `accountDb()` is)

**Interfaces:**
- Produces:
  ```ts
  export function isCronAuthorized(header: string | null, secret: string): boolean;  // the existing sha256 + timingSafeEqual
  export interface CleanupResult { purged: number; failed: number }
  export async function runUploadsCleanup(db: Db, store: ObjectStore, now: Date, max = 1000): Promise<CleanupResult>;
  // per row: delete object + thumb, then markPurged (pending → deleted); one failure doesn't stop the rest
  ```
- **The cron:** `vercel.json` gains `{ "path": "/api/cron/uploads-cleanup", "schedule": "30 3 * * *" }`.
- **`package.json`:** `"uploads:cleanup": "node scripts/uploads-cleanup.ts"` and `"uploads:check-r2": "node scripts/r2-check.ts"`.
- **The scripts** follow `run-closures.ts`: `.env.local`, the module runner, print the host and the counts, never a key.
  - `NOW=` works on `uploads:cleanup`.
  - `r2-check` puts a 16-byte WebP header to `check/<uuid>.webp` through a signed `PUT` (real `fetch`), then heads it, reads 16 bytes, `detectType`s them, signs a `GET` and fetches it, then deletes. It prints one line per step: `ok` or the error name.

- [ ] **Step 1: Write the failing tests.**
  - **`cron-auth`:** the existing route test's cases.
  - **Cleanup:** these rows each have their objects deleted and `purged_at` set, and a stale pending becomes `deleted`:
    - pending at `now − 25h`;
    - rejected with `purged_at` null;
    - deleted with `purged_at` null.
  - **Left alone:** a pending at `now − 1h`, a `ready` file, and a deleted file already purged. Their objects stay.
  - **One failing delete:** `failed: 1`, and the others are purged.
  - **The route:** a copy of `-account-closures.int.test.ts`. 401 with no header or a wrong secret; 200 `{ purged, failed }` with `no-store`; a no-store 500 that logs the error name only; GET only.
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3:** Implement, and switch `account-closures.ts` to `isCronAuthorized`. Its test must still pass unchanged.
- [ ] **Step 4:** Run again, and run `vp run uploads:cleanup` against `dev`. Expected: `Purged 0, failed 0`.
- [ ] **Step 5:** Commit: `feat: daily uploads cleanup on Vercel Cron, by hand with vp run uploads:cleanup, and an R2 check script`.

---

### Task 9: Browser client

**Files:**
- Create: `src/features/uploads/client.ts`, `src/features/uploads/client.browser.test.tsx`

**Interfaces:**
- Consumes: Task 1's limits and copy.
- Produces:
  ```ts
  export class UploadError extends Error {}  // message is one of UPLOAD_COPY / the server's sentence, shown as is
  export interface PreparedImage { image: Blob; thumb: Blob; mime: "image/webp" | "image/jpeg"; width: number; height: number }
  export async function prepareImage(file: File): Promise<PreparedImage>;
  export interface UploadDeps {
    createUpload(input: CreateUploadInput): Promise<WriteResult<UploadTicket>>;
    confirmUpload(fileId: string): Promise<WriteResult<{ fileId: string; status: FileStatus; message: string | null }>>;
    put(url: string, body: Blob, contentType: string, onProgress: (sent: number) => void): Promise<void>; // default: XHR
  }
  export async function uploadFile(
    file: File, target: { kind: FileKind; parentId: string },
    deps: UploadDeps, onProgress?: (fraction: number) => void,
  ): Promise<{ fileId: string; status: FileStatus; message: string | null }>;
  export const xhrPut: UploadDeps["put"];
  ```
- **The rules:**
  - The size check (`ORIGINAL_MAX_BYTES`) and the type check come first, before any decode.
  - `createImageBitmap(file, { imageOrientation: "from-image" })`; a failure → `UploadError(heic)` for HEIC/HEIF input, else "That file isn't a photo."
  - Scale so the long side ≤ 2048 (never upscale). Draw on an `OffscreenCanvas` where available, else a `<canvas>`.
  - Encode with `convertToBlob({ type: "image/webp", quality: 0.85 })`. If the blob's type isn't WebP, use JPEG at 0.85 (call P3), and the thumbnail follows the same mime.
  - The thumbnail is 400 px wide.
  - Documents go through as they are, checked as `application/pdf` by type and size.
  - Progress is (bytes sent of main + thumb) / (their total).
  - A refusal from either server call becomes `UploadError(error.message)`.

- [ ] **Step 1: Write the failing tests** (Chromium):
  - **Resize and strip:** a 4032×3024 JPEG made on a canvas, with a hand-built APP1 Exif segment carrying a GPS IFD spliced in after SOI. Assert the input contains `Exif` and `GPS` byte runs first. Then `prepareImage` gives:
    - `mime: "image/webp"` in Chromium;
    - the bytes start `RIFF` and contain no `Exif`;
    - `createImageBitmap(image)` reports 2048×1536;
    - the thumbnail is 400 wide.
  - **Too big:** an 11 MB `File` typed `image/jpeg` rejects with `tooBig`, and a spy `createUpload` is never called.
  - **Not a photo:** a `text/html` file rejects with "That file isn't a photo."
  - **Progress:** `uploadFile` with fake deps whose `put` reports halfway then full. The `onProgress` values are non-decreasing and end at 1, and `confirmUpload` is called once with the ticket's `fileId`.
  - **A refusal:** `createUpload` → `{ ok: false, error: { message: "This claim already has 10 photos." } }` rejects with that message.
- [ ] **Step 2:** Ask Damion whether `vp dev` is running (the memory note). Then `vp test --project component src/features/uploads`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: browser upload client, resizing photos to WebP without EXIF, with a thumbnail and progress`.

---

### Task 10: `/dev/uploads`

**Files:**
- Create: `src/features/uploads/server.ts`, `UploadsTestPage.tsx`, `UploadsTestPage.browser.test.tsx`, `src/routes/dev.uploads.tsx`
- Modify: `src/routeTree.gen.ts` (generated)

**Interfaces:**
- Consumes: Tasks 5, 6, 9; `listMyClaims`; `userMiddleware`, `permissionMiddleware("claims.read_all")`.
- Produces (server functions; each starts with `devOnly()`, which throws `notFound()` when `process.env.VERCEL_TARGET_ENV === "production"`):
  ```ts
  getUploadsTestPage: GET → { staff: boolean; claims: { id; reference; status; acceptsUploads: boolean; files: (FileView & { thumbUrl })[] }[] }
  createMyUpload: POST (CreateUploadInput) → WriteResult<UploadTicket>
  confirmMyUpload: POST ({ fileId }) → WriteResult<…>
  openMyFile: GET ({ fileId }) → FileLink
  staffClaimFiles: GET ({ reference }) → staff list
  staffOpenFile: GET ({ fileId }) → FileLink
  ```
- **The route** `/dev/uploads`:
  - `headers` `private, no-store`;
  - `beforeLoad` runs `requireSignedIn`, then the loader;
  - `head` title "Upload test · Kerb".
- **The page:**
  - **Per claim:** reference, status and a drop area (`onDragOver`/`onDrop`), with a "Choose file" `Button` over a hidden `<input type="file" accept="image/*,application/pdf" multiple>`.
  - **Per file:** a `role="progressbar"` with `aria-valuenow`, then the thumbnail (`<img>` from `thumbUrl`) or a `file-text` icon, the status, and an "Open" link that calls `openMyFile` and then `window.open(url)`.
  - **Refusals:** shown in an `Alert tone="danger" announce`.
  - **Staff:** a box with a reference input, a list, and "Open" through `staffOpenFile`.
  - **No new design:** existing components, plain layout.
- **Picking the uploader:** an image `File` goes through `uploadFile` with the image kind; a PDF goes as `claim_document`.

- [ ] **Step 1: Write the failing tests** (mocked `./server`, like `account.browser.test.tsx`):
  - A claim that accepts uploads shows "Choose file". A settled one says it doesn't take new files and has no button.
  - Choosing a PDF calls `createMyUpload` with `kind: "claim_document"`. When the mock refuses with "This claim already has 5 documents.", that sentence shows in an alert.
- [ ] **Step 2:** Run `vp run generate-routes`, then the component test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: /dev/uploads test page, never in production`.

---

### Task 11: Docs, gate, manual check, PR

**Files:**
- Modify: `plan/engineering.md` §6 (keys kind-first, Kerbie in Phase 7 with its 30-day rule, `purged_at`, the cleanup, the closure split, links 5 min, the JPEG fallback) and §9 (CSP R2 origin); `plan/dev-database.md` ("Uploads on dev": Ben Okafor / KRB-C-90001 accepts uploads, Amelia's settled claim refuses, `vp run uploads:check-r2`, `vp run uploads:cleanup`); `.env.example` R2 comment; the spec's Status and Results; `phase.md` 4.10 row; `build-plan.md` box.

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2: Gate.** After asking Damion about `vp dev`: `vp check`, `vp test`, `vp build`. Expected: all pass.
- [ ] **Step 3: R2 (once Damion has set the `R2_*` values).** Run `vp run uploads:check-r2`. Expected: every step `ok`. Then sign in locally as Ben Okafor and upload a photo and a PDF to KRB-C-90001 on `/dev/uploads`.
- [ ] **Step 4:** Push `slice/4.10-uploads` and open the PR into `staging` with the spec's commit message as its title. The body links the spec and the plan, lists P1–P6, and copies "Done when". The `Co-authored-by: Opsed Solutions <damionwilson@opsedsolutions.com>` trailer goes in a commit.
- [ ] **Step 5: Damion's manual check** (spec "Tests", Manual row). Run it on staging from a phone and a laptop, then `vp run db:check-app-role` against `dev`, and record the results in the spec.
