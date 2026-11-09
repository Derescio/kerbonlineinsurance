# 4.10 Upload foundation

**Status:** approved (Damion, 8 Nov 2026); plan and build by the next session
**Phase:** 04-data-auth

## Goal

Every file a customer gives Kerb (claim photos, claim documents, review photos, and later photos sent to Kerbie) goes through one foundation. Feature slices only call it.

- **Straight to storage.** The browser uploads directly to Cloudflare R2 with a short-lived signed link. Files never pass through Vercel, which refuses request bodies over about 4.5 MB.
- **Private by default.** Nobody gets a file without the server first checking they're allowed to see it. Each link the server hands out expires in 5 minutes.
- **Safe images.** Photos are shrunk to at most 2048 px and re-encoded as WebP in the browser before upload. Re-encoding strips EXIF, including the GPS location (damage photos are often taken at home), and the browser also makes a 400 px thumbnail.
- **Checked after upload.** The server checks the first bytes of every file. A renamed `.exe` is rejected whatever its name says.
- **Tried for real.** A test page lets you upload to a seeded claim from a laptop (drag and drop, or Choose file) and from a phone (Choose file, which offers the library, camera or Files).

The real upload screens arrive with their features, designed in Figma first: the claim photo grid in 6.5 and review photos in 6.7. 4.10 builds the plumbing and a plain test page.

## Decisions

1. **One private bucket per environment** (Damion, 8 Nov 2026), per engineering.md §6.
   - **Buckets:** `kerb-dev` (local, previews, staging) and `kerb-prod` (production).
   - **Placement:** both created in **Western Europe** as a location hint, with no EU jurisdiction. The app uses the standard endpoint `https://<account-id>.r2.cloudflarestorage.com`.
   - **Tokens:** one R2 API token per bucket, with Object Read & Write on that bucket only.
2. **Documents and images share a bucket** (Damion, 8 Nov 2026). They're told apart by `kind`, which sets the allowed types, size and count, and which is part of each file's path.
3. **Laptops and phones both work** (Damion, 8 Nov 2026).
   - **Laptops:** drag and drop, or a Choose file button.
   - **Phones:** the button only, which offers the photo library, the camera or Files.
4. **A test page, never in production** (Damion, 8 Nov 2026). `/dev/uploads` shows the signed-in customer's claims, with upload, progress, thumbnails and opening a file. It's for proving the foundation, not the 6.5 design.

## Calls I've made (check these)

5. **Paths start with the kind:** `{kind}/{userId}/{fileId}.webp|pdf`, plus `{kind}/{userId}/{fileId}-thumb.webp` for an image.
   - **Change from engineering.md:** it said `users/{userId}/{kind}/…`. Deleting a person's files always goes through the `files` table, so putting the user first buys nothing.
   - **What kind-first buys:** R2's own expiry rules can work per kind. For example, Phase 7 can make everything under `kerbie_image/` expire after 30 days, as a backstop to the cleanup job.
   - engineering.md §6 is updated to match.
6. **4.10 supports three kinds; Kerbie's comes with Kerbie.** `claim_photo`, `claim_document` and `review_photo` have parents today (claims and reviews). `kerbie_image` needs the chat tables (Phase 7), so Phase 7 adds it, its parent column and its 30-day expiry. Limits, unchanged from engineering.md:

   | Kind | Types accepted | Stored as | Max size | Max count |
   |---|---|---|---|---|
   | `claim_photo` | JPEG, PNG, WebP, HEIC | WebP ≤ 2048 px, plus a 400 px thumbnail | 10 MB before resize | 10 per claim |
   | `claim_document` | PDF | as uploaded | 10 MB | 5 per claim |
   | `review_photo` | JPEG, PNG, WebP, HEIC | WebP ≤ 2048 px, plus a 400 px thumbnail | 10 MB before resize | 3 per review |

   - **Counting:** both `pending` and `ready` files count towards the limit, so two tabs can't sneak an eleventh photo in.
   - **The 10 MB limit:** it's checked in the browser before resizing. The server limits what is actually uploaded: 4 MB for a resized image or thumbnail, 10 MB for a PDF. Those sizes are signed into the upload link, so R2 refuses anything bigger.
7. **Who may upload where.**
   - **Claims:** only the claim's own customer, and only while the claim is `draft` or open (`received`, `assessing`, `approved`). Evidence can be added while the claim is handled, never after it's settled or declined.
   - **Reviews:** only the review's own customer, and only while it's `pending`. A published review's photos are fixed.
   - **The check:** it reuses the 4.5 data layer, so someone else's claim or review is `NOT_FOUND`, never "forbidden".
8. **Who may view.**
   - **The owner:** sees their own files.
   - **Staff with `claims.read_all`:** see claim files, but never on their own claim (the 4.5 conflict-of-interest rule).
   - **Audit:** each staff view writes a `file.viewed` audit row. It's a new action in `AUDIT_ACTIONS`, which 6.10 relies on.
   - **Review photos:** staff view these through moderation (6.8), not in 4.10. The public route `/media/r/:fileId` for published review photos is 6.9's.
9. **Deleting a file.** `deleteMyFile` lets the owner remove a photo or document from a **draft** claim, or from a pending review. It deletes the object and marks the row `deleted`. Once a claim is submitted, its evidence is a record and stays.
10. **Closing an account (4.7's 30-day path) keeps claim evidence.**
    - **Kept:** the files of submitted claims, for as long as the claim's records are retained.
    - **Deleted:** files on draft claims and on reviews, because 4.7 deletes those drafts and reviews.

    `closeAccountRows` calls the file cleanup inside its transaction.
11. **Immediate delete fills in the 4.7 hook.** `deleteUserFiles(tx, userId)` marks the user's rows `deleted` inside the delete's transaction and returns their object keys. The caller deletes the objects **after** the transaction commits, so a rollback never leaves rows pointing at missing files.
    - **Leftover rows:** `files.owner_user_id` is `ON DELETE SET NULL`, so once the user row is gone, these `deleted` rows stay behind with no personal link.
    - **Failed object deletes:** the daily cleanup finds them through those rows and deletes the objects.
12. **A daily cleanup job.** `/api/cron/uploads-cleanup`, protected by `CRON_SECRET` in a Vercel Cron, as `account-closures` is. It deletes:
    - `pending` files older than 24 hours;
    - `rejected` files;
    - `deleted` rows whose object is still there.

    `vp run uploads:cleanup` runs it by hand, since Vercel Cron only calls Production. 4.11 moves it onto the jobs table.
13. **Storage behind a small interface.** `ObjectStore` covers:
    - `presignPut`
    - `presignGet`
    - `head`
    - `readFirstBytes`
    - `delete`

    There are two implementations:
    - **R2:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, server-only, path-style URLs on the account endpoint.
    - **In-memory fake:** for the integration tests, so `ci` never needs R2 credentials.

    A manual check against the real `kerb-dev` proves the R2 one.
14. **HEIC (iPhone photos).**
    - **Most iPhones:** the file picker usually hands Safari a JPEG already.
    - **When the browser can decode it:** if the browser can decode HEIC (Safari can), it's converted like any other image.
    - **When it can't:** the page says "This photo's format isn't supported here. Try saving it as a JPEG." Nothing is uploaded.
15. **The browser's security rules (CSP) allow the R2 endpoint.**
    - **Which lists:** `connect-src` for the upload, and `img-src` for thumbnails and opened images.
    - **Which origin:** only that environment's `https://<account-id>.r2.cloudflarestorage.com`, built from `R2_ACCOUNT_ID`, never a wildcard.
    - **Previews:** `img-src` also gains `blob:`, so a picked photo can preview before it uploads.
16. **The camera header stays off.** `Permissions-Policy: camera=()` governs live camera access by the page (`getUserMedia`). It doesn't stop a phone's file picker offering the camera, so nothing changes there.
17. **Rate limit.** `createUpload` goes through the shared 4.5c limiter: 60 per user per hour.
18. **The `files` table is in the data contract.** It's copied (metadata only, a dataset for the data video), with the `record_delete` trigger.
    - **Kept:** `object_key` and `thumb_key`, with `owner_user_id` hashed.
    - **Not stored:** the original filename, which can be personal ("Jane Smith passport.pdf").
    - **App access:** `kerb_app` gets the default grants.

## The test page, `/dev/uploads`

- **Production:** 404 there (`VERCEL_TARGET_ENV === "production"`). Present on localhost, previews and staging.
- **Signed-in customer:** lists their claims from the 4.5 data layer. Ben Okafor (`+customer-b`) has KRB-C-90001, being assessed, so it accepts uploads. Amelia's claim is settled and refuses them (call 7). Under each claim:
  - a drop area with a **Choose file** button, accepting images and PDFs;
  - per file, a progress bar, then a thumbnail (images) or a PDF icon;
  - the file's status (`ready` / `rejected`), and a link that opens it through `getFileUrl`.
- **Staff member:** a box takes a claim reference and shows that claim's files as staff see them (audited).
- **Refusals:** shown as the server's own messages, e.g. "This claim already has 10 photos", "That file isn't a PDF".
- **Built from existing components:** Button, the progress and alert styles. No new design.

## In scope

- **Schema:** `files` table and migration (generated, plus the hand-written `record_delete` trigger); the data contract entry; `file.viewed` in `AUDIT_ACTIONS`.
- **Server:**
  - `src/server/uploads/`: limits, keys, magic bytes, `ObjectStore` and its R2 and fake implementations;
  - `src/server/data/files.ts`: `createUpload`, `confirmUpload`, `getFileUrl`, `deleteMyFile`, `listFilesForClaim`, cleanup;
  - the `deleteUserFiles` and closure hooks;
  - the cron route and `vp run uploads:cleanup`;
  - R2 env in `env.ts`, and the CSP origins.
- **Browser:** `src/features/uploads/client.ts`, which resizes, re-encodes to WebP (stripping EXIF), makes the thumbnail and uploads with progress; and the `/dev/uploads` page.
- **Docs:** engineering.md §6 (path order, Kerbie later, cleanup); `plan/dev-database.md` gains a short "Uploads on dev" note.

## Out of scope

- The real upload UI: the claim photo grid (6.5), review photos (6.7) and staff viewing in the claims console (6.10).
- `kerbie_image` and its 30-day expiry (Phase 7).
- The public `/media/r/:fileId` route for published review photos (6.9).
- Virus scanning: the magic-byte check plus PDF-only documents is the v1 defence.
- Moving the cleanup onto the jobs table (4.11).

## What you set up

1. **Each bucket's CORS policy** (R2 → bucket → Settings → CORS policy).

   For `kerb-dev`:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://kerbonlineinsurance-staging.vercel.app", "https://*.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   For `kerb-prod`, the same, with `"AllowedOrigins": ["https://kerbonlineinsurance.vercel.app"]`.

   CORS isn't the security boundary. Only Kerb's server can issue an upload link, and each link is for one file of one type and size.
2. **Env variables:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
   - The `kerb-dev` values go in `.env.local` and in Vercel's Development, Preview and Staging.
   - The `kerb-prod` values go in Production.
   - Never paste the values in chat.
3. **Tools for the check:** a photo from your phone of about 10–12 MB, and `exiftool` (or any EXIF viewer) for the GPS check.

## Tests

| Layer | What | Gate? |
|---|---|---|
| Unit | Limits per kind; object keys; magic-byte detection (JPEG, PNG, WebP, PDF; a renamed `.exe` and an HTML file refused); CSP includes the R2 origin only when `R2_ACCOUNT_ID` is set | yes |
| Integration | `createUpload` refuses an unknown kind, a wrong type, an oversize file, an 11th photo or a 6th PDF (`pending` counts), and someone else's claim (`NOT_FOUND`), a settled claim and a published review; it writes a `pending` row; rate limit at 60 | yes |
| Integration | `confirmUpload` with the fake store: a real JPEG/WebP/PDF becomes `ready`; a renamed `.exe` becomes `rejected` and its object is deleted; confirming someone else's file is `NOT_FOUND` | yes |
| Integration | `getFileUrl`: the owner gets a link; customer B gets `NOT_FOUND` for customer A's file; a handler gets a claim file with a `file.viewed` audit row; a handler on their own claim is refused; a deactivated handler is refused | yes |
| Integration | `deleteMyFile` only on a draft claim or a pending review; immediate delete marks rows `deleted` and the objects go after commit; a rolled-back delete leaves both; closure deletes draft-claim and review files and keeps submitted claims' | yes |
| Integration | Cleanup removes old `pending`, `rejected` and leftover `deleted` objects, leaves `ready` ones; the cron route refuses a missing or wrong `CRON_SECRET` | yes |
| Component | In real Chromium: a large JPEG with GPS EXIF comes out as WebP ≤ 2048 px with no EXIF; the thumbnail is 400 px wide; progress reports; an over-10 MB file is refused before upload | yes |
| Manual | On staging from a phone, signed in as Ben Okafor: a 12 MB photo uploads to KRB-C-90001; the network tab shows the `PUT` to R2, not Vercel; the downloaded file is WebP ≤ 2048 px with no GPS (`exiftool`); a renamed `.exe` is rejected; signed in as Amelia Hart, Ben's file link fails | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` pass, and `ci` is green on the PR.
- [ ] The manual check above passes on staging, from a phone and from a laptop.
- [ ] `vp run db:check-app-role` passes with the `files` table.

## Commit message

`feat: uploads straight to R2 with signed links, photos resized to WebP without location data, file checks by content, ownership and staff access, cleanup, and a test page`

## Sources

**Plan:**
- phase.md 4.10 row and testing rows, and the exit criteria;
- engineering.md §6 (file storage) and §9 (CSP);
- 4.5 data layer and conflict-of-interest rule;
- 4.5c rate limiter;
- 4.7 call 17 (`deleteUserFiles`) and `closeAccountRows`;
- 6.5, 6.7, 6.9, 6.10 rows.

**Damion, 8 Nov 2026:** buckets and tokens created, Western Europe, no jurisdiction; one bucket per environment, with documents and images told apart inside it; laptops drag or choose, phones choose; a test page that never reaches production.
