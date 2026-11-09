import type { WriteResult } from "#/lib/validation";
import type { CreateUploadInput, UploadResult, UploadTicket } from "#/server/data/files";
import type { FileKind } from "#/server/db/schema/values";
import {
  IMAGE_INPUT_TYPES,
  IMAGE_MAX_PX,
  KIND_LIMITS,
  ORIGINAL_MAX_BYTES,
  THUMB_WIDTH,
  UPLOAD_COPY,
} from "#/server/uploads/limits";

// The browser half of uploads (4.10). A photo is shrunk to at most 2048 px and re-encoded on a
// canvas before it leaves the device: canvas output carries no EXIF, so the GPS location a phone
// writes into a photo never reaches Kerb. A 400 px thumbnail is made the same way. Then the file
// goes straight to R2 on the signed link (never through Vercel), with progress, and the server is
// asked to check it.
//
// WebP where the browser can encode it. Safari's canvas can't (it hands back PNG), so there the
// photo is a JPEG instead, which drops EXIF just the same (plan call P3).

export class UploadError extends Error {
  override name = "UploadError";
}

export interface PreparedImage {
  image: Blob;
  thumb: Blob;
  mime: "image/webp" | "image/jpeg";
  width: number;
  height: number;
}

const QUALITY = 0.85;
const HEIC = /^image\/hei[cf]$/;
const HEIC_NAME = /\.(heic|heif)$/i;

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: "image/webp" | "image/jpeg",
): Promise<Blob> {
  const paint = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    // JPEG has no transparency: a transparent PNG would otherwise turn black
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
  };
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UploadError(UPLOAD_COPY.notPhoto);
    paint(ctx);
    return canvas.convertToBlob({ type, quality: QUALITY });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UploadError(UPLOAD_COPY.notPhoto);
  paint(ctx);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new UploadError(UPLOAD_COPY.notPhoto))),
      type,
      QUALITY,
    ),
  );
}

/** Checks, decodes, shrinks and re-encodes one photo, and makes its thumbnail */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > ORIGINAL_MAX_BYTES) throw new UploadError(UPLOAD_COPY.tooBig);
  const heic = HEIC.test(file.type) || HEIC_NAME.test(file.name);
  if (!heic && !IMAGE_INPUT_TYPES.includes(file.type)) {
    throw new UploadError(UPLOAD_COPY.notPhoto);
  }

  let bitmap: ImageBitmap;
  try {
    // Applies the EXIF orientation before the EXIF is dropped, so a portrait stays upright
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UploadError(heic ? UPLOAD_COPY.heic : UPLOAD_COPY.notPhoto);
  }

  try {
    const scale = Math.min(1, IMAGE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const webp = await encode(bitmap, width, height, "image/webp");
    const mime = webp.type === "image/webp" ? "image/webp" : "image/jpeg";
    const image = mime === "image/webp" ? webp : await encode(bitmap, width, height, mime);

    const thumbWidth = Math.min(THUMB_WIDTH, width);
    const thumbHeight = Math.max(1, Math.round((height * thumbWidth) / width));
    const thumb = await encode(bitmap, thumbWidth, thumbHeight, mime);
    return { image, thumb, mime, width, height };
  } finally {
    bitmap.close();
  }
}

export interface UploadDeps {
  createUpload: (input: CreateUploadInput) => Promise<WriteResult<UploadTicket>>;
  confirmUpload: (fileId: string) => Promise<WriteResult<UploadResult>>;
  /** PUTs one object, reporting bytes sent so far */
  put: (
    url: string,
    body: Blob,
    contentType: string,
    onProgress: (sent: number) => void,
  ) => Promise<void>;
}

/** PUT with upload progress, which fetch can't report */
export const xhrPut: UploadDeps["put"] = (url, body, contentType, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadError(UPLOAD_COPY.uploadFailed));
    xhr.onerror = () => reject(new UploadError(UPLOAD_COPY.uploadFailed));
    xhr.onabort = () => reject(new UploadError(UPLOAD_COPY.uploadFailed));
    xhr.send(body);
  });

/**
 * Prepares one file for `target`, uploads it and has the server check it. `onProgress` gets the
 * fraction of bytes sent, 0 to 1. A refusal, from this browser or the server, throws UploadError
 * with the sentence to show.
 */
export async function uploadFile(
  file: File,
  target: { kind: FileKind; parentId: string },
  deps: UploadDeps,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  const rule = KIND_LIMITS[target.kind];
  let parts: { body: Blob; mime: string }[];
  let input: CreateUploadInput;

  if (rule.image) {
    const prepared = await prepareImage(file);
    parts = [
      { body: prepared.image, mime: prepared.mime },
      { body: prepared.thumb, mime: prepared.mime },
    ];
    input = {
      kind: target.kind,
      parentId: target.parentId,
      mime: prepared.mime,
      sizeBytes: prepared.image.size,
      thumbSizeBytes: prepared.thumb.size,
      width: prepared.width,
      height: prepared.height,
    };
  } else {
    if (file.type !== "application/pdf") throw new UploadError(rule.typeMessage);
    if (file.size > ORIGINAL_MAX_BYTES) throw new UploadError(UPLOAD_COPY.tooBig);
    parts = [{ body: file, mime: file.type }];
    input = { kind: target.kind, parentId: target.parentId, mime: file.type, sizeBytes: file.size };
  }

  const created = await deps.createUpload(input);
  if (!created.ok) throw new UploadError(created.error.message);
  const ticket = created.data;
  const links = [ticket.upload, ticket.thumbUpload].filter((link) => link !== null);

  const total = parts.reduce((sum, part) => sum + part.body.size, 0);
  const sent = parts.map(() => 0);
  const report = () => onProgress?.(Math.min(1, sent.reduce((a, b) => a + b, 0) / total));
  onProgress?.(0);
  for (const [index, link] of links.entries()) {
    const part = parts[index]!;
    await deps.put(link.url, part.body, link.contentType, (bytes) => {
      sent[index] = Math.min(bytes, part.body.size);
      report();
    });
    sent[index] = part.body.size;
    report();
  }

  const confirmed = await deps.confirmUpload(ticket.fileId);
  if (!confirmed.ok) throw new UploadError(confirmed.error.message);
  return confirmed.data;
}
