import type { FileKind, FileMime } from "#/server/db/schema/values";

// Upload limits per kind (4.10, call 6). Pure and import-free apart from types, so the browser
// client checks the same numbers before it uploads. The server re-checks what is actually signed.

export const MB = 1024 * 1024;

/** Every signed PUT and GET expires after this many seconds */
export const LINK_SECONDS = 300;

/** Photos are shrunk so the long side is at most this, and get a thumbnail this wide */
export const IMAGE_MAX_PX = 2048;
export const THUMB_WIDTH = 400;

/** Checked in the browser, before resizing */
export const ORIGINAL_MAX_BYTES = 10 * MB;

export const UPLOAD_COPY = {
  tooBig: "That file is too big. The limit is 10 MB.",
  notPhoto: "That file isn't a photo.",
  notPdf: "That file isn't a PDF.",
  claimClosed: "This claim can't take new files.",
  reviewClosed: "This review can't take new photos.",
  removeRefused: "Files can only be removed from a draft claim or a pending review.",
  notReceived: "We didn't receive that file. Please try again.",
  heic: "This photo's format isn't supported here. Try saving it as a JPEG.",
} as const;

export interface KindLimit {
  parent: "claim" | "review";
  image: boolean;
  /** What may be stored (and signed into the upload link) */
  mimes: readonly FileMime[];
  /** The largest object the server signs, per object (a thumbnail has the same cap) */
  maxBytes: number;
  /** pending and ready files both count */
  maxCount: number;
  countMessage: string;
  typeMessage: string;
}

const imageMimes: readonly FileMime[] = ["image/webp", "image/jpeg"];

export const KIND_LIMITS: Readonly<Record<FileKind, KindLimit>> = {
  claim_photo: {
    parent: "claim",
    image: true,
    mimes: imageMimes,
    maxBytes: 4 * MB,
    maxCount: 10,
    countMessage: "This claim already has 10 photos.",
    typeMessage: UPLOAD_COPY.notPhoto,
  },
  claim_document: {
    parent: "claim",
    image: false,
    mimes: ["application/pdf"],
    maxBytes: 10 * MB,
    maxCount: 5,
    countMessage: "This claim already has 5 documents.",
    typeMessage: UPLOAD_COPY.notPdf,
  },
  review_photo: {
    parent: "review",
    image: true,
    mimes: imageMimes,
    maxBytes: 4 * MB,
    maxCount: 3,
    countMessage: "This review already has 3 photos.",
    typeMessage: UPLOAD_COPY.notPhoto,
  },
};

/** What the browser accepts as a photo before re-encoding it */
export const IMAGE_INPUT_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/** null when the stored type and size are allowed for the kind, else the sentence to show */
export function checkUpload(kind: FileKind, mime: string, bytes: number): string | null {
  const rule = KIND_LIMITS[kind];
  if (!(rule.mimes as readonly string[]).includes(mime)) return rule.typeMessage;
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > rule.maxBytes) return UPLOAD_COPY.tooBig;
  return null;
}
