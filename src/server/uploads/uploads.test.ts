import { describe, expect, it } from "vite-plus/test";

import { extensionFor, objectKey, thumbKey } from "./keys";
import { checkUpload, KIND_LIMITS, MB, UPLOAD_COPY } from "./limits";
import { detectType } from "./magic";

// The pure parts of the upload foundation (4.10): limits per kind, object keys and the magic-byte
// check.

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((value) =>
      typeof value === "number" ? [value] : [...value].map((char) => char.charCodeAt(0)),
    ),
  );

describe("checkUpload", () => {
  it("accepts a resized photo up to 4 MB", () => {
    expect(checkUpload("claim_photo", "image/webp", 4 * MB)).toBeNull();
    expect(checkUpload("review_photo", "image/jpeg", 1000)).toBeNull();
  });

  it("refuses a photo over 4 MB, an empty file and a non-integer size", () => {
    expect(checkUpload("claim_photo", "image/webp", 4 * MB + 1)).toBe(UPLOAD_COPY.tooBig);
    expect(checkUpload("claim_photo", "image/webp", 0)).toBe(UPLOAD_COPY.tooBig);
    expect(checkUpload("claim_photo", "image/webp", 1.5)).toBe(UPLOAD_COPY.tooBig);
  });

  it("accepts a PDF up to 10 MB", () => {
    expect(checkUpload("claim_document", "application/pdf", 10 * MB)).toBeNull();
    expect(checkUpload("claim_document", "application/pdf", 10 * MB + 1)).toBe(UPLOAD_COPY.tooBig);
  });

  it("refuses the wrong type for the kind", () => {
    expect(checkUpload("claim_document", "image/webp", 10)).toBe("That file isn't a PDF.");
    expect(checkUpload("claim_photo", "application/pdf", 10)).toBe("That file isn't a photo.");
    expect(checkUpload("claim_photo", "application/x-msdownload", 10)).toBe(
      "That file isn't a photo.",
    );
    // PNG is an input type, never a stored one: the browser re-encodes it
    expect(checkUpload("claim_photo", "image/png", 10)).toBe("That file isn't a photo.");
  });

  it("has the counts and their sentences", () => {
    expect(KIND_LIMITS.claim_photo).toMatchObject({
      maxCount: 10,
      countMessage: "This claim already has 10 photos.",
    });
    expect(KIND_LIMITS.claim_document).toMatchObject({
      maxCount: 5,
      countMessage: "This claim already has 5 documents.",
    });
    expect(KIND_LIMITS.review_photo).toMatchObject({
      maxCount: 3,
      countMessage: "This review already has 3 photos.",
    });
  });
});

describe("object keys", () => {
  it("puts the kind first", () => {
    expect(objectKey("claim_photo", "u1", "f1", "image/webp")).toBe("claim_photo/u1/f1.webp");
    expect(thumbKey("claim_photo", "u1", "f1", "image/webp")).toBe("claim_photo/u1/f1-thumb.webp");
    expect(objectKey("review_photo", "u1", "f1", "image/jpeg")).toBe("review_photo/u1/f1.jpg");
    expect(objectKey("claim_document", "u1", "f1", "application/pdf")).toBe(
      "claim_document/u1/f1.pdf",
    );
  });

  it("maps each stored type to one extension", () => {
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("application/pdf")).toBe("pdf");
  });
});

describe("detectType", () => {
  it("knows JPEG, PNG, WebP and PDF", () => {
    expect(detectType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(detectType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectType(bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
    expect(detectType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("refuses a renamed .exe, HTML and other RIFF files", () => {
    expect(detectType(bytes("MZ", 0x90, 0, 3, 0, 0, 0))).toBeNull();
    expect(detectType(bytes("<!DOCTYPE html>"))).toBeNull();
    expect(detectType(bytes("<html><body>"))).toBeNull();
    expect(detectType(bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt "))).toBeNull();
  });

  it("refuses too few bytes", () => {
    expect(detectType(bytes())).toBeNull();
    expect(detectType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectType(bytes("RIFF"))).toBeNull();
  });
});
