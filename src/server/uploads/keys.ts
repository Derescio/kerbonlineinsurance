import type { FileKind, FileMime } from "#/server/db/schema/values";

// Object keys (4.10, call 5): kind first, so R2's own expiry rules can work per kind (Phase 7's
// 30-day rule on kerbie_image/). Deleting a person's files always goes through the files table.

const EXTENSIONS = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
} as const satisfies Record<FileMime, string>;

export function extensionFor(mime: FileMime): (typeof EXTENSIONS)[FileMime] {
  return EXTENSIONS[mime];
}

export function objectKey(kind: FileKind, userId: string, fileId: string, mime: FileMime): string {
  return `${kind}/${userId}/${fileId}.${extensionFor(mime)}`;
}

export function thumbKey(kind: FileKind, userId: string, fileId: string, mime: FileMime): string {
  return `${kind}/${userId}/${fileId}-thumb.${extensionFor(mime)}`;
}
