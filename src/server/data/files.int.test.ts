import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { verifyAuditChain } from "#/server/audit/verify";
import { resolveActor, type Actor } from "#/server/auth/actor";
import { AuthzError, RateLimitError, type AuthzCode } from "#/server/auth/errors";
import { closeDb, getDb } from "#/server/db/client";
import { auditLog, files } from "#/server/db/schema";
import { getAuditEnv } from "#/server/env";
import { MB, UPLOAD_COPY } from "#/server/uploads/limits";
import { setObjectStore } from "#/server/uploads/store";
import { MemoryObjectStore } from "#/server/uploads/store-memory";
import { env } from "#/test/auth";
import { getOwnerDb, truncateAll } from "#/test/db";
import {
  makeClaim,
  makeCustomer,
  makeFile,
  makePolicy,
  makeReview,
  makeStaff,
} from "#/test/factories";

import {
  confirmUpload,
  createUpload,
  deleteMyFile,
  getMyFileUrl,
  listMyClaimFiles,
  staffGetFileUrl,
  staffListClaimFiles,
  type CreateUploadInput,
} from "./files";

// The upload foundation's data layer (4.10) against the in-memory object store: limits, ownership,
// the content check, removal, and who may open what.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new TextEncoder().encode("RIFF\x24\0\0\0WEBPVP8 \0\0\0\0");
const PDF = new TextEncoder().encode("%PDF-1.7\n%\xe2\xe3\n1 0 obj");
const EXE = new TextEncoder().encode("MZ\x90\0\x03\0\0\0\x04\0\0\0\xff\xff\0\0");

let store: MemoryObjectStore;
const headers = new Headers();

const actorOf = async (userId: string) =>
  (await resolveActor(getDb(), userId, { twoFactorVerifiedAt: new Date() }))!;

async function customerWithClaim(status = "assessing") {
  const customer = await makeCustomer();
  const policy = await makePolicy({ customerId: customer.id });
  const claim = await makeClaim({ customerId: customer.id, policyId: policy.id, status });
  return { customer, policy, claim, actor: await actorOf(customer.userId) };
}

const photo = (parentId: string, extra: Partial<CreateUploadInput> = {}): CreateUploadInput => ({
  kind: "claim_photo",
  parentId,
  mime: "image/webp",
  sizeBytes: 900_000,
  thumbSizeBytes: 30_000,
  width: 2048,
  height: 1536,
  ...extra,
});

const create = (actor: Actor | null, input: CreateUploadInput) =>
  createUpload(actor, { input }, { headers });
const confirm = (actor: Actor | null, fileId: string) =>
  confirmUpload(actor, { input: { fileId } }, { headers });
const remove = (actor: Actor | null, fileId: string) =>
  deleteMyFile(actor, { input: { fileId } }, { headers });

async function codeOf(call: Promise<unknown>): Promise<AuthzCode | null> {
  try {
    await call;
    return null;
  } catch (error) {
    if (error instanceof AuthzError) return error.code;
    throw error;
  }
}

async function messageOf(call: ReturnType<typeof create>) {
  const result = await call;
  return result.ok ? null : result.error.message;
}

const fileRow = async (id: string) =>
  (await getDb().select().from(files).where(eq(files.id, id)))[0]!;

afterAll(closeDb);
beforeEach(async () => {
  // rateLimitSubject reads its secret from the whole auth env, which this project doesn't set
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  await truncateAll();
  store = new MemoryObjectStore();
  setObjectStore(store);
});
afterEach(() => {
  setObjectStore(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createUpload", () => {
  it("writes a pending row and signs a link for the photo and its thumbnail", async () => {
    const { actor, claim } = await customerWithClaim();
    const result = await create(actor, photo(claim.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fileId, upload, thumbUpload, expiresInSeconds } = result.data;
    const base = `claim_photo/${actor.userId}/${fileId}`;
    expect(upload).toEqual({ url: `memory://put/${base}.webp`, contentType: "image/webp" });
    expect(thumbUpload).toEqual({
      url: `memory://put/${base}-thumb.webp`,
      contentType: "image/webp",
    });
    expect(expiresInSeconds).toBe(300);
    expect(await fileRow(fileId)).toMatchObject({
      status: "pending",
      kind: "claim_photo",
      claimId: claim.id,
      reviewId: null,
      ownerUserId: actor.userId,
      objectKey: `${base}.webp`,
      thumbKey: `${base}-thumb.webp`,
      sizeBytes: 900_000,
      confirmedAt: null,
    });
  });

  it("takes a PDF on a draft claim, with no thumbnail", async () => {
    const { actor, claim } = await customerWithClaim("draft");
    const result = await create(actor, {
      kind: "claim_document",
      parentId: claim.id,
      mime: "application/pdf",
      sizeBytes: 9 * MB,
    });
    expect(result.ok && result.data.thumbUpload).toBeNull();
    expect(result.ok && result.data.upload.url).toMatch(
      /^memory:\/\/put\/claim_document\/.+\.pdf$/,
    );
  });

  it("takes a photo on the customer's own pending review", async () => {
    const { actor, customer, policy } = await customerWithClaim();
    const review = await makeReview({ customerId: customer.id, policyId: policy.id });
    const result = await create(actor, photo(review.id, { kind: "review_photo" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect((await fileRow(result.data.fileId)).reviewId).toBe(review.id);
  });

  it("refuses an unknown kind as a validation failure", async () => {
    const { actor, claim } = await customerWithClaim();
    const result = await create(actor, photo(claim.id, { kind: "kerbie_image" as never }));
    expect(result.ok ? null : result.error.code).toBe("VALIDATION");
  });

  it("refuses the wrong type and an oversize file with its own sentence", async () => {
    const { actor, claim } = await customerWithClaim();
    expect(await messageOf(create(actor, photo(claim.id, { mime: "application/pdf" })))).toBe(
      "That file isn't a photo.",
    );
    expect(
      await messageOf(create(actor, photo(claim.id, { mime: "application/x-msdownload" }))),
    ).toBe("That file isn't a photo.");
    expect(
      await messageOf(
        create(actor, {
          kind: "claim_document",
          parentId: claim.id,
          mime: "image/webp",
          sizeBytes: 9,
        }),
      ),
    ).toBe("That file isn't a PDF.");
    expect(await messageOf(create(actor, photo(claim.id, { sizeBytes: 4 * MB + 1 })))).toBe(
      UPLOAD_COPY.tooBig,
    );
    expect(await messageOf(create(actor, photo(claim.id, { thumbSizeBytes: undefined })))).toBe(
      UPLOAD_COPY.tooBig,
    );
    expect(await getDb().select().from(files)).toHaveLength(0);
  });

  it("refuses an 11th photo and a 6th PDF, counting pending files", async () => {
    const { actor, claim } = await customerWithClaim();
    for (let i = 0; i < 10; i++) {
      await makeFile({ claimId: claim.id, status: i % 2 ? "ready" : "pending" });
    }
    for (let i = 0; i < 5; i++) await makeFile({ claimId: claim.id, kind: "claim_document" });
    // Rejected and deleted files don't count
    await makeFile({ claimId: claim.id, status: "rejected" });
    await makeFile({ claimId: claim.id, status: "deleted" });

    expect(await messageOf(create(actor, photo(claim.id)))).toBe(
      "This claim already has 10 photos.",
    );
    expect(
      await messageOf(
        create(actor, {
          kind: "claim_document",
          parentId: claim.id,
          mime: "application/pdf",
          sizeBytes: 1000,
        }),
      ),
    ).toBe("This claim already has 5 documents.");
  });

  it("refuses a 4th review photo", async () => {
    const { actor, customer, policy } = await customerWithClaim();
    const review = await makeReview({ customerId: customer.id, policyId: policy.id });
    for (let i = 0; i < 3; i++) await makeFile({ reviewId: review.id });
    expect(await messageOf(create(actor, photo(review.id, { kind: "review_photo" })))).toBe(
      "This review already has 3 photos.",
    );
  });

  it("waits on the claim while another tab takes the 10th place, then refuses", async () => {
    const { actor, claim } = await customerWithClaim();
    for (let i = 0; i < 9; i++) await makeFile({ claimId: claim.id });
    const tenth = await makeFile({ claimId: claim.id, status: "deleted" });

    // Another tab's createUpload, part way through: it holds the claim and is adding the 10th
    const other = await getOwnerDb().$client.connect();
    try {
      await other.query("begin");
      await other.query("select 1 from claims where id = $1 for no key update", [claim.id]);
      let settled = false;
      const call = create(actor, photo(claim.id)).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await other.query("update files set status = 'pending' where id = $1", [tenth.id]);
      await other.query("commit");
      expect(await messageOf(call)).toBe("This claim already has 10 photos.");
    } finally {
      other.release();
    }
  });

  it("hides someone else's claim and review as not found", async () => {
    const a = await customerWithClaim();
    const b = await customerWithClaim();
    const reviewA = await makeReview({ customerId: a.customer.id, policyId: a.policy.id });
    expect(await codeOf(create(b.actor, photo(a.claim.id)))).toBe("NOT_FOUND");
    expect(await codeOf(create(b.actor, photo(reviewA.id, { kind: "review_photo" })))).toBe(
      "NOT_FOUND",
    );
    // A claim id given as a review's, or a made-up one
    expect(await codeOf(create(a.actor, photo(a.claim.id, { kind: "review_photo" })))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(create(a.actor, photo(randomUUID())))).toBe("NOT_FOUND");
  });

  it("gives staff with no customer row NOT_FOUND", async () => {
    const { claim } = await customerWithClaim();
    const staff = await makeStaff();
    expect(await codeOf(create(await actorOf(staff.userId), photo(claim.id)))).toBe("NOT_FOUND");
  });

  it("refuses a settled or declined claim and a published review", async () => {
    for (const status of ["settled", "declined"]) {
      const { actor, claim } = await customerWithClaim(status);
      expect(await messageOf(create(actor, photo(claim.id)))).toBe(
        "This claim can't take new files.",
      );
    }
    const { actor, customer, policy } = await customerWithClaim();
    const review = await makeReview({
      customerId: customer.id,
      policyId: policy.id,
      status: "published",
    });
    expect(await messageOf(create(actor, photo(review.id, { kind: "review_photo" })))).toBe(
      "This review can't take new photos.",
    );
  });

  it("takes 60 requests an hour, refused ones included", async () => {
    const { actor, claim } = await customerWithClaim("settled");
    for (let i = 0; i < 60; i++) expect((await create(actor, photo(claim.id))).ok).toBe(false);
    await expect(create(actor, photo(claim.id))).rejects.toBeInstanceOf(RateLimitError);
  });

  it("needs a signed-in user", async () => {
    const { claim } = await customerWithClaim();
    expect(await codeOf(create(null, photo(claim.id)))).toBe("UNAUTHENTICATED");
  });
});

describe("confirmUpload", () => {
  async function uploaded(bytes: Uint8Array, input: Partial<CreateUploadInput> = {}) {
    const ctx = await customerWithClaim();
    const result = await create(ctx.actor, photo(ctx.claim.id, input));
    if (!result.ok) throw new Error(result.error.message);
    const row = await fileRow(result.data.fileId);
    store.put(row.objectKey, bytes, row.mime);
    if (row.thumbKey) store.put(row.thumbKey, bytes, row.mime);
    return { ...ctx, row, fileId: result.data.fileId };
  }

  it("makes a real WebP, JPEG or PDF ready", async () => {
    for (const [bytes, input] of [
      [WEBP, {}],
      [JPEG, { mime: "image/jpeg" }],
      [PDF, { kind: "claim_document", mime: "application/pdf", thumbSizeBytes: undefined }],
    ] as const) {
      const { actor, fileId } = await uploaded(bytes, input);
      expect(await confirm(actor, fileId)).toEqual({
        ok: true,
        data: { fileId, status: "ready", message: null },
      });
      expect((await fileRow(fileId)).confirmedAt).not.toBeNull();
    }
  });

  it("rejects a renamed .exe and deletes its objects", async () => {
    const { actor, fileId, row } = await uploaded(EXE);
    expect(await confirm(actor, fileId)).toEqual({
      ok: true,
      data: { fileId, status: "rejected", message: "That file isn't a photo." },
    });
    expect(store.has(row.objectKey)).toBe(false);
    expect(store.has(row.thumbKey!)).toBe(false);
    const after = await fileRow(fileId);
    expect(after.status).toBe("rejected");
    expect(after.purgedAt).not.toBeNull();
  });

  it("rejects a photo whose thumbnail isn't one", async () => {
    const { actor, fileId, row } = await uploaded(WEBP);
    store.put(row.thumbKey!, EXE, "image/webp");
    expect(await confirm(actor, fileId)).toMatchObject({ data: { status: "rejected" } });
  });

  it("says the file didn't arrive, and leaves it pending", async () => {
    const { actor, claim } = await customerWithClaim();
    const result = await create(actor, photo(claim.id));
    const fileId = result.ok ? result.data.fileId : "";
    expect(await confirm(actor, fileId)).toEqual({
      ok: false,
      error: expect.objectContaining({ message: UPLOAD_COPY.notReceived }),
    });
    expect((await fileRow(fileId)).status).toBe("pending");
  });

  it("answers a repeat from the row, without reading R2", async () => {
    const { actor, fileId } = await uploaded(WEBP);
    await confirm(actor, fileId);
    const read = vi.spyOn(store, "readFirstBytes");
    expect(await confirm(actor, fileId)).toMatchObject({ data: { status: "ready" } });
    expect(read).not.toHaveBeenCalled();
  });

  it("never revives a file the cleanup already took", async () => {
    const { actor, fileId } = await uploaded(WEBP);
    await getDb().update(files).set({ status: "deleted" }).where(eq(files.id, fileId));
    expect(await confirm(actor, fileId)).toMatchObject({ data: { status: "deleted" } });
  });

  it("hides someone else's file as not found", async () => {
    const { fileId } = await uploaded(WEBP);
    const other = await customerWithClaim();
    expect(await codeOf(confirm(other.actor, fileId))).toBe("NOT_FOUND");
    expect((await fileRow(fileId)).status).toBe("pending");
  });
});

describe("deleteMyFile", () => {
  async function withFile(claimStatus: string) {
    const ctx = await customerWithClaim(claimStatus);
    const file = await makeFile({ claimId: ctx.claim.id });
    store.put(file.objectKey, WEBP, "image/webp");
    store.put(file.thumbKey!, WEBP, "image/webp");
    return { ...ctx, file };
  }

  it("removes a draft claim's file and its objects", async () => {
    const { actor, file } = await withFile("draft");
    expect(await remove(actor, file.id)).toEqual({
      ok: true,
      data: { fileId: file.id, status: "deleted" },
    });
    expect(store.keys()).toEqual([]);
    expect(await fileRow(file.id)).toMatchObject({ status: "deleted" });
    expect((await fileRow(file.id)).purgedAt).not.toBeNull();
  });

  it("removes a pending review's photo", async () => {
    const { actor, customer, policy } = await customerWithClaim();
    const review = await makeReview({ customerId: customer.id, policyId: policy.id });
    const file = await makeFile({ reviewId: review.id });
    expect((await remove(actor, file.id)).ok).toBe(true);
  });

  it("keeps a submitted claim's evidence and a published review's photo", async () => {
    const { actor, customer, policy, file } = await withFile("received");
    expect(await remove(actor, file.id)).toEqual({
      ok: false,
      error: expect.objectContaining({ message: UPLOAD_COPY.removeRefused }),
    });
    const review = await makeReview({
      customerId: customer.id,
      policyId: policy.id,
      status: "published",
    });
    const reviewFile = await makeFile({ reviewId: review.id });
    expect((await remove(actor, reviewFile.id)).ok).toBe(false);
    expect((await fileRow(file.id)).status).toBe("ready");
    expect(store.has(file.objectKey)).toBe(true);
  });

  it("hides someone else's file as not found", async () => {
    const { file } = await withFile("draft");
    const other = await customerWithClaim();
    expect(await codeOf(remove(other.actor, file.id))).toBe("NOT_FOUND");
  });

  it("still removes the row when R2 is down, leaving the objects to the cleanup", async () => {
    const { actor, file } = await withFile("draft");
    store.failDeletes = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await remove(actor, file.id)).ok).toBe(true);
    const after = await fileRow(file.id);
    expect(after.status).toBe("deleted");
    expect(after.purgedAt).toBeNull();
  });
});

describe("customer reads", () => {
  it("lists the customer's claim files with thumbnail links for ready photos", async () => {
    const { actor, claim } = await customerWithClaim();
    const ready = await makeFile({ claimId: claim.id });
    const pending = await makeFile({ claimId: claim.id, status: "pending" });
    const pdf = await makeFile({ claimId: claim.id, kind: "claim_document" });
    await makeFile({ claimId: claim.id, status: "deleted" });

    const listed = await listMyClaimFiles(actor, { claimId: claim.id });
    expect(listed.map((f) => [f.id, f.status, f.thumbUrl])).toEqual([
      [ready.id, "ready", `memory://get/${ready.thumbKey}`],
      [pending.id, "pending", null],
      [pdf.id, "ready", null],
    ]);
    expect(listed[0]).not.toHaveProperty("thumbKey");
    expect(listed[0]).not.toHaveProperty("objectKey");
  });

  it("gives the owner a link, and anyone else NOT_FOUND", async () => {
    const { actor, claim } = await customerWithClaim();
    const file = await makeFile({ claimId: claim.id });
    expect(await getMyFileUrl(actor, { fileId: file.id })).toEqual({
      fileId: file.id,
      url: `memory://get/${file.objectKey}`,
      thumbUrl: `memory://get/${file.thumbKey}`,
      mime: "image/webp",
      expiresInSeconds: 300,
    });
    const other = await customerWithClaim();
    expect(await codeOf(getMyFileUrl(other.actor, { fileId: file.id }))).toBe("NOT_FOUND");
    expect(await codeOf(listMyClaimFiles(other.actor, { claimId: claim.id }))).toBe("NOT_FOUND");
  });

  it("opens a ready file after its claim is settled, but not a pending or rejected one", async () => {
    const { actor, claim } = await customerWithClaim("settled");
    const ready = await makeFile({ claimId: claim.id });
    const pending = await makeFile({ claimId: claim.id, status: "pending" });
    const rejectedFile = await makeFile({ claimId: claim.id, status: "rejected" });
    expect((await getMyFileUrl(actor, { fileId: ready.id })).fileId).toBe(ready.id);
    expect(await codeOf(getMyFileUrl(actor, { fileId: pending.id }))).toBe("NOT_FOUND");
    expect(await codeOf(getMyFileUrl(actor, { fileId: rejectedFile.id }))).toBe("NOT_FOUND");
  });
});

describe("staff reads", () => {
  const auditRows = () => getDb().select().from(auditLog).orderBy(asc(auditLog.id));

  it("opens a claim file for a handler and audits it", async () => {
    const { claim } = await customerWithClaim();
    const file = await makeFile({ claimId: claim.id });
    const handler = await actorOf((await makeStaff()).userId);

    const link = await staffGetFileUrl(handler, { fileId: file.id });
    expect(link.url).toBe(`memory://get/${file.objectKey}`);
    expect(await auditRows()).toMatchObject([
      {
        action: "file.viewed",
        entityType: "file",
        entityId: file.id,
        actorUserId: handler.userId,
        actorRole: "claims_handler",
        changes: { claimId: claim.id },
      },
    ]);
    expect(await verifyAuditChain(getDb().$client, getAuditEnv())).toMatchObject({ ok: true });
  });

  it("lists a claim's files by reference without opening or auditing anything", async () => {
    const { claim } = await customerWithClaim();
    const file = await makeFile({ claimId: claim.id });
    const handler = await actorOf((await makeStaff()).userId);
    const listed = await staffListClaimFiles(handler, { reference: claim.reference });
    expect(listed).toMatchObject({ claimId: claim.id, reference: claim.reference });
    expect(listed.files.map((f) => f.id)).toEqual([file.id]);
    expect(JSON.stringify(listed)).not.toContain("memory://");
    expect(await codeOf(staffListClaimFiles(handler, { reference: "KRB-C-00000" }))).toBe(
      "NOT_FOUND",
    );
    expect(await auditRows()).toHaveLength(0);
  });

  it("refuses staff their own claim's files, and a deactivated handler any", async () => {
    const customer = await makeCustomer();
    await makeStaff({ roles: ["admin"], userId: customer.userId });
    const own = await makeClaim({ customerId: customer.id });
    const file = await makeFile({ claimId: own.id });
    const adminCustomer = await actorOf(customer.userId);
    expect(await codeOf(staffGetFileUrl(adminCustomer, { fileId: file.id }))).toBe(
      "CONFLICT_OF_INTEREST",
    );
    expect(await codeOf(staffListClaimFiles(adminCustomer, { reference: own.reference }))).toBe(
      "CONFLICT_OF_INTEREST",
    );

    const deactivated = await makeStaff({
      startedAt: new Date("2026-01-01T00:00:00Z"),
      deactivatedAt: new Date("2026-02-01T00:00:00Z"),
    });
    expect(
      await codeOf(staffGetFileUrl(await actorOf(deactivated.userId), { fileId: file.id })),
    ).toBe("FORBIDDEN");
    expect(await auditRows()).toHaveLength(0);
  });

  it("treats a review photo and a pending claim file as not found, with no audit row", async () => {
    const { customer, policy, claim } = await customerWithClaim();
    const review = await makeReview({ customerId: customer.id, policyId: policy.id });
    const reviewFile = await makeFile({ reviewId: review.id });
    const pending = await makeFile({ claimId: claim.id, status: "pending" });
    const handler = await actorOf((await makeStaff()).userId);
    expect(await codeOf(staffGetFileUrl(handler, { fileId: reviewFile.id }))).toBe("NOT_FOUND");
    expect(await codeOf(staffGetFileUrl(handler, { fileId: pending.id }))).toBe("NOT_FOUND");
    expect(await auditRows()).toHaveLength(0);
  });

  it("refuses a customer", async () => {
    const { actor, claim } = await customerWithClaim();
    const file = await makeFile({ claimId: claim.id });
    expect(await codeOf(staffGetFileUrl(actor, { fileId: file.id }))).toBe("FORBIDDEN");
  });
});
