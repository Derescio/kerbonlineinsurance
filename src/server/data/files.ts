import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { OPEN_CLAIM_STATUSES } from "#/server/account/constants";
import { audit } from "#/server/audit/audit";
import { assertNoConflict, type Actor } from "#/server/auth/actor";
import { AuthzError, logSafeError } from "#/server/auth/errors";
import type { Db } from "#/server/db/client";
import { claims, files, reviews } from "#/server/db/schema";
import { withTx, type Tx } from "#/server/db/tx";
import {
  fileKinds,
  type FileKind,
  type FileMime,
  type FileStatus,
} from "#/server/db/schema/values";
import { objectKey, thumbKey } from "#/server/uploads/keys";
import {
  checkUpload,
  IMAGE_MAX_PX,
  KIND_LIMITS,
  LINK_SECONDS,
  UPLOAD_COPY,
} from "#/server/uploads/limits";
import { detectType, MAGIC_BYTES } from "#/server/uploads/magic";
import { getObjectStore } from "#/server/uploads/store";

import { defineRead, defineWrite, rejected } from "./define";

// Uploads (4.10). The browser asks createUpload for a signed link, PUTs the file straight to R2,
// then calls confirmUpload, which reads the object's first bytes. Ownership goes through the
// customer's own claim or review, so anyone else's is NOT_FOUND. Staff read claim files, never
// their own, and every file they open is audited. The raw row helpers for the account hooks and
// the cleanup are in file-rows.ts.

/** Claims take evidence while a draft and while open; never once settled or declined */
const UPLOAD_CLAIM_STATUSES: readonly string[] = ["draft", ...OPEN_CLAIM_STATUSES];
const CLAIM_KINDS: readonly FileKind[] = ["claim_photo", "claim_document"];
const COUNTED: readonly FileStatus[] = ["pending", "ready"];

export const UPLOAD_RULE = { max: 60, windowSeconds: 60 * 60 };

// --- Writes ---

const dimension = z.number().int().min(1).max(IMAGE_MAX_PX);

// The type and size are plain values here so checkUpload can answer with its own sentence
const createInput = z.object({
  kind: z.enum(fileKinds),
  parentId: z.uuid(),
  mime: z.string().max(100),
  sizeBytes: z.number(),
  thumbSizeBytes: z.number().optional(),
  width: dimension.optional(),
  height: dimension.optional(),
});

export type CreateUploadInput = z.input<typeof createInput>;

export type UploadTicket = {
  fileId: string;
  expiresInSeconds: number;
  upload: { url: string; contentType: string };
  thumbUpload: { url: string; contentType: string } | null;
};

export type UploadResult = { fileId: string; status: FileStatus; message: string | null };

/** The parent, locked so two tabs can't both take the last place; null if it isn't theirs */
async function lockParent(
  tx: Tx,
  kind: FileKind,
  parentId: string,
  customerId: string,
): Promise<{ open: boolean } | null> {
  if (KIND_LIMITS[kind].parent === "claim") {
    const [claim] = await tx
      .select({ status: claims.status })
      .from(claims)
      .where(and(eq(claims.id, parentId), eq(claims.customerId, customerId)))
      .for("no key update");
    return claim ? { open: UPLOAD_CLAIM_STATUSES.includes(claim.status) } : null;
  }
  const [review] = await tx
    .select({ status: reviews.status })
    .from(reviews)
    .where(and(eq(reviews.id, parentId), eq(reviews.customerId, customerId)))
    .for("no key update");
  return review ? { open: review.status === "pending" } : null;
}

export const createUpload = defineWrite(
  createInput,
  { limit: { action: "upload.create", rule: UPLOAD_RULE } },
  async (actor, input, tx) => {
    const rule = KIND_LIMITS[input.kind];
    const refused = checkUpload(input.kind, input.mime, input.sizeBytes);
    if (refused) return rejected(refused);
    if (rule.image) {
      const thumb = input.thumbSizeBytes;
      if (thumb === undefined || checkUpload(input.kind, input.mime, thumb)) {
        return rejected(UPLOAD_COPY.tooBig);
      }
    }
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");

    const parent = await lockParent(tx, input.kind, input.parentId, actor.customerId);
    if (!parent) throw new AuthzError("NOT_FOUND");
    if (!parent.open) {
      return rejected(rule.parent === "claim" ? UPLOAD_COPY.claimClosed : UPLOAD_COPY.reviewClosed);
    }

    const parentColumn = rule.parent === "claim" ? files.claimId : files.reviewId;
    const [taken] = await tx
      .select({ n: count() })
      .from(files)
      .where(
        and(
          eq(parentColumn, input.parentId),
          eq(files.kind, input.kind),
          inArray(files.status, [...COUNTED]),
        ),
      );
    if ((taken?.n ?? 0) >= rule.maxCount) return rejected(rule.countMessage);

    // The id goes into the key, so it's drawn first (time-ordered, like every other id)
    const { rows } = await tx.execute<{ id: string }>(sql`select uuidv7() as id`);
    const fileId = rows[0]!.id;
    const mime = input.mime as FileMime;
    const key = objectKey(input.kind, actor.userId, fileId, mime);
    const thumb = rule.image ? thumbKey(input.kind, actor.userId, fileId, mime) : null;
    await tx.insert(files).values({
      id: fileId,
      ownerUserId: actor.userId,
      kind: input.kind,
      claimId: rule.parent === "claim" ? input.parentId : null,
      reviewId: rule.parent === "review" ? input.parentId : null,
      status: "pending",
      objectKey: key,
      thumbKey: thumb,
      mime,
      sizeBytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
    });

    const store = getObjectStore();
    const ticket: UploadTicket = {
      fileId,
      expiresInSeconds: LINK_SECONDS,
      upload: {
        url: await store.presignPut(key, { contentType: mime, contentLength: input.sizeBytes }),
        contentType: mime,
      },
      thumbUpload:
        thumb && input.thumbSizeBytes
          ? {
              url: await store.presignPut(thumb, {
                contentType: mime,
                contentLength: input.thumbSizeBytes,
              }),
              contentType: mime,
            }
          : null,
    };
    return ticket;
  },
);

const fileInput = z.object({ fileId: z.uuid() });

/** The actor's own file, locked for this write; anyone else's is NOT_FOUND */
async function lockOwnFile(tx: Tx, actor: Actor, fileId: string) {
  const [file] = await tx
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerUserId, actor.userId)))
    .for("update");
  if (!file) throw new AuthzError("NOT_FOUND");
  return file;
}

const keysOf = (file: { objectKey: string; thumbKey: string | null }) =>
  file.thumbKey ? [file.objectKey, file.thumbKey] : [file.objectKey];

export const confirmUpload = defineWrite(fileInput, {}, async (actor, { fileId }, tx) => {
  const file = await lockOwnFile(tx, actor, fileId);
  // A repeat, or a file the cleanup already took: say where it stands, never revive it
  if (file.status !== "pending") {
    return { fileId, status: file.status as FileStatus, message: null } satisfies UploadResult;
  }

  const store = getObjectStore();
  const keys = keysOf(file);
  for (const key of keys) {
    if (!(await store.head(key))) return rejected(UPLOAD_COPY.notReceived);
  }
  let matches = true;
  for (const key of keys) {
    if (detectType(await store.readFirstBytes(key, MAGIC_BYTES)) !== file.mime) matches = false;
  }

  if (!matches) {
    // Not what it claimed to be: gone from R2 now, and the row says so
    for (const key of keys) await store.delete(key);
    await tx
      .update(files)
      .set({ status: "rejected", purgedAt: sql`now()` })
      .where(eq(files.id, fileId));
    const message = KIND_LIMITS[file.kind as FileKind].typeMessage;
    return { fileId, status: "rejected", message } satisfies UploadResult;
  }

  await tx
    .update(files)
    .set({ status: "ready", confirmedAt: sql`now()` })
    .where(eq(files.id, fileId));
  return { fileId, status: "ready", message: null } satisfies UploadResult;
});

/** Whether the file's parent still lets its owner remove it: a draft claim or a pending review */
async function removable(tx: Tx, file: { claimId: string | null; reviewId: string | null }) {
  if (file.claimId) {
    const [claim] = await tx
      .select({ status: claims.status })
      .from(claims)
      .where(eq(claims.id, file.claimId));
    return claim?.status === "draft";
  }
  if (file.reviewId) {
    const [review] = await tx
      .select({ status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, file.reviewId));
    return review?.status === "pending";
  }
  return false;
}

export const deleteMyFile = defineWrite(fileInput, {}, async (actor, { fileId }, tx) => {
  const file = await lockOwnFile(tx, actor, fileId);
  if (file.status === "deleted") return { fileId, status: "deleted" as const };
  // Once a claim is submitted its evidence is a record, and a published review's photos are fixed
  if (!(await removable(tx, file))) return rejected(UPLOAD_COPY.removeRefused);

  await tx.update(files).set({ status: "deleted" }).where(eq(files.id, fileId));
  try {
    const store = getObjectStore();
    for (const key of keysOf(file)) await store.delete(key);
    await tx
      .update(files)
      .set({ purgedAt: sql`now()` })
      .where(eq(files.id, fileId));
  } catch (error) {
    // The row stays deleted with purged_at empty, and the daily cleanup retries the objects
    console.error("[uploads] delete failed:", logSafeError(error));
  }
  return { fileId, status: "deleted" as const };
});

// --- Reads ---

export interface FileView {
  id: string;
  kind: FileKind;
  status: FileStatus;
  mime: FileMime;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

export interface FileLink {
  fileId: string;
  url: string;
  thumbUrl: string | null;
  mime: FileMime;
  expiresInSeconds: number;
}

const viewColumns = {
  id: files.id,
  kind: files.kind,
  status: files.status,
  mime: files.mime,
  sizeBytes: files.sizeBytes,
  width: files.width,
  height: files.height,
  createdAt: files.createdAt,
  thumbKey: files.thumbKey,
};

type ViewRow = Omit<FileView, "kind" | "status" | "mime"> & {
  kind: string;
  status: string;
  mime: string;
  thumbKey: string | null;
};

function toView({ thumbKey: _thumbKey, ...row }: ViewRow): FileView {
  return {
    ...row,
    kind: row.kind as FileKind,
    status: row.status as FileStatus,
    mime: row.mime as FileMime,
  };
}

async function linkFor(file: {
  id: string;
  objectKey: string;
  thumbKey: string | null;
  mime: string;
}): Promise<FileLink> {
  const store = getObjectStore();
  return {
    fileId: file.id,
    url: await store.presignGet(file.objectKey),
    thumbUrl: file.thumbKey ? await store.presignGet(file.thumbKey) : null,
    mime: file.mime as FileMime,
    expiresInSeconds: LINK_SECONDS,
  };
}

/** A claim's files that haven't been removed, oldest first */
function claimFiles(db: Db | Tx, claimId: string) {
  return db
    .select(viewColumns)
    .from(files)
    .where(and(eq(files.claimId, claimId), ne(files.status, "deleted")))
    .orderBy(asc(files.createdAt), asc(files.id));
}

export type MyClaimFile = FileView & { thumbUrl: string | null };

/** The customer's own claim's files, with a thumbnail link for each ready photo */
export const listMyClaimFiles = defineRead(
  "signed_in",
  z.object({ claimId: z.uuid() }),
  async (actor, { claimId }, db): Promise<MyClaimFile[]> => {
    if (!actor.customerId) throw new AuthzError("NOT_FOUND");
    const [claim] = await db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.id, claimId), eq(claims.customerId, actor.customerId)));
    if (!claim) throw new AuthzError("NOT_FOUND");
    const store = getObjectStore();
    const rows = await claimFiles(db, claimId);
    return Promise.all(
      rows.map(async (row) => ({
        ...toView(row),
        thumbUrl:
          row.status === "ready" && row.thumbKey ? await store.presignGet(row.thumbKey) : null,
      })),
    );
  },
);

/** A link to one of the actor's own ready files. Its parent's state doesn't matter */
export const getMyFileUrl = defineRead(
  "signed_in",
  fileInput,
  async (actor, { fileId }, db): Promise<FileLink> => {
    const [file] = await db
      .select()
      .from(files)
      .where(
        and(eq(files.id, fileId), eq(files.ownerUserId, actor.userId), eq(files.status, "ready")),
      );
    if (!file) throw new AuthzError("NOT_FOUND");
    return linkFor(file);
  },
);

export interface StaffClaimFiles {
  claimId: string;
  reference: string;
  files: FileView[];
}

/** A claim's files as staff see them: metadata only, so nothing is opened and nothing audited */
export const staffListClaimFiles = defineRead(
  "claims.read_all",
  z.object({ reference: z.string().regex(/^KRB-C-[0-9]{5}$/) }),
  async (actor, { reference }, db): Promise<StaffClaimFiles> => {
    const [claim] = await db
      .select({ id: claims.id, customerId: claims.customerId })
      .from(claims)
      .where(eq(claims.reference, reference));
    if (!claim) throw new AuthzError("NOT_FOUND");
    assertNoConflict(actor, claim.customerId);
    const rows = await claimFiles(db, claim.id);
    return { claimId: claim.id, reference, files: rows.map(toView) };
  },
);

/** A link to a claim's ready file for staff, never on their own claim, with a file.viewed row */
export const staffGetFileUrl = defineRead(
  "claims.read_all",
  fileInput,
  async (actor, { fileId }, db): Promise<FileLink> => {
    // One transaction, so the view is recorded only if the read succeeds (as staffGetClaim)
    return withTx(db, async (tx) => {
      const [file] = await tx
        .select({
          id: files.id,
          objectKey: files.objectKey,
          thumbKey: files.thumbKey,
          mime: files.mime,
          claimId: claims.id,
          customerId: claims.customerId,
        })
        .from(files)
        .innerJoin(claims, eq(claims.id, files.claimId))
        .where(
          and(
            eq(files.id, fileId),
            eq(files.status, "ready"),
            inArray(files.kind, [...CLAIM_KINDS]),
          ),
        );
      if (!file) throw new AuthzError("NOT_FOUND");
      assertNoConflict(actor, file.customerId);
      await audit(tx, {
        actor,
        action: "file.viewed",
        entityId: fileId,
        changes: { claimId: file.claimId },
      });
      return linkFor(file);
    });
  },
);
