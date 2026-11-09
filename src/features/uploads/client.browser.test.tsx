import { describe, expect, it, vi } from "vite-plus/test";

import { MB, UPLOAD_COPY } from "#/server/uploads/limits";

import { prepareImage, uploadFile, UploadError, type UploadDeps } from "./client";

// The upload client in real Chromium (4.10): a large phone-sized JPEG carrying GPS in its EXIF
// comes out as a WebP of at most 2048 px with no EXIF, with a 400 px thumbnail; refusals happen
// before anything is uploaded; progress is reported.

/** A JPEG drawn on a canvas, so the test needs no fixture file */
async function canvasJpeg(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0b6e4f");
  gradient.addColorStop(1, "#f2c14e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * An APP1 Exif segment whose IFD0 points at a GPS IFD holding GPSLatitudeRef "N": the shape a
 * phone writes, small enough to build by hand. Big-endian TIFF.
 */
function exifWithGps(): Uint8Array<ArrayBuffer> {
  const tiff = [
    77, 77, 0, 42, 0, 0, 0, 8, 0, 1, 136, 37, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 1, 0, 1,
    0, 2, 0, 0, 0, 2, 78, 0, 0, 0, 0, 0, 0, 0,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...payload]);
}

/** Splices the Exif segment in straight after the JPEG's start-of-image marker */
function withExif(jpeg: Uint8Array): Uint8Array<ArrayBuffer> {
  const exif = exifWithGps();
  const out = new Uint8Array(jpeg.length + exif.length);
  out.set(jpeg.subarray(0, 2));
  out.set(exif, 2);
  out.set(jpeg.subarray(2), 2 + exif.length);
  return out;
}

function contains(haystack: Uint8Array, needle: string): boolean {
  const bytes = new TextEncoder().encode(needle);
  outer: for (let i = 0; i + bytes.length <= haystack.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (haystack[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

function fakeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    createUpload: vi.fn(async () => ({
      ok: true as const,
      data: {
        fileId: "f1",
        expiresInSeconds: 300,
        upload: { url: "https://r2.test/main", contentType: "image/webp" },
        thumbUpload: { url: "https://r2.test/thumb", contentType: "image/webp" },
      },
    })),
    confirmUpload: vi.fn(async (fileId: string) => ({
      ok: true as const,
      data: { fileId, status: "ready" as const, message: null },
    })),
    put: vi.fn(async (_url, body: Blob, _type, onProgress: (sent: number) => void) => {
      onProgress(Math.floor(body.size / 2));
      onProgress(body.size);
    }),
    ...overrides,
  };
}

describe("prepareImage", () => {
  it("shrinks a 4032×3024 JPEG with GPS EXIF to a 2048 px WebP without EXIF", async () => {
    const input = withExif(await canvasJpeg(4032, 3024));
    expect(contains(input, "Exif")).toBe(true);
    expect(contains(input, "MM\0*")).toBe(true);
    const file = new File([input], "IMG_0001.jpg", { type: "image/jpeg" });

    const prepared = await prepareImage(file);
    expect(prepared).toMatchObject({ mime: "image/webp", width: 2048, height: 1536 });
    const image = await bytesOf(prepared.image);
    expect(new TextDecoder().decode(image.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(image.subarray(8, 12))).toBe("WEBP");
    expect(contains(image, "Exif")).toBe(false);
    expect(contains(image, "MM\0*")).toBe(false);

    const decoded = await createImageBitmap(prepared.image);
    expect([decoded.width, decoded.height]).toEqual([2048, 1536]);
    const thumb = await createImageBitmap(prepared.thumb);
    expect([thumb.width, thumb.height]).toEqual([400, 300]);
    expect(contains(await bytesOf(prepared.thumb), "Exif")).toBe(false);
  });

  it("never upscales a small photo", async () => {
    const file = new File([await canvasJpeg(300, 200)], "small.jpg", { type: "image/jpeg" });
    const prepared = await prepareImage(file);
    expect([prepared.width, prepared.height]).toEqual([300, 200]);
    expect((await createImageBitmap(prepared.thumb)).width).toBe(300);
  });

  it("refuses a file over 10 MB before reading it", async () => {
    const file = new File([new Uint8Array(10 * MB + 1)], "big.jpg", { type: "image/jpeg" });
    await expect(prepareImage(file)).rejects.toThrow(UPLOAD_COPY.tooBig);
  });

  it("refuses a file that isn't a photo, and a photo that won't decode", async () => {
    const html = new File(["<html></html>"], "page.html", { type: "text/html" });
    await expect(prepareImage(html)).rejects.toThrow("That file isn't a photo.");
    const broken = new File(["MZ not really"], "evil.jpg", { type: "image/jpeg" });
    await expect(prepareImage(broken)).rejects.toThrow("That file isn't a photo.");
  });

  it("asks for a JPEG when a HEIC photo can't be decoded here", async () => {
    const heic = new File([new Uint8Array(64)], "IMG_0002.HEIC", { type: "image/heic" });
    await expect(prepareImage(heic)).rejects.toThrow(UPLOAD_COPY.heic);
  });
});

describe("uploadFile", () => {
  const photo = async () =>
    new File([await canvasJpeg(1200, 900)], "dent.jpg", { type: "image/jpeg" });

  it("uploads the photo and its thumbnail, reports progress to 1, then confirms", async () => {
    const deps = fakeDeps();
    const progress: number[] = [];
    const result = await uploadFile(
      await photo(),
      { kind: "claim_photo", parentId: "c1" },
      deps,
      (fraction) => progress.push(fraction),
    );

    expect(result).toEqual({ fileId: "f1", status: "ready", message: null });
    expect(deps.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "claim_photo",
        parentId: "c1",
        mime: "image/webp",
        width: 1200,
        height: 900,
      }),
    );
    expect(vi.mocked(deps.put).mock.calls.map((call) => call[0])).toEqual([
      "https://r2.test/main",
      "https://r2.test/thumb",
    ]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(deps.confirmUpload).toHaveBeenCalledExactlyOnceWith("f1");
  });

  it("sends a PDF as it is, with no thumbnail", async () => {
    const deps = fakeDeps({
      createUpload: vi.fn(async () => ({
        ok: true as const,
        data: {
          fileId: "f2",
          expiresInSeconds: 300,
          upload: { url: "https://r2.test/doc", contentType: "application/pdf" },
          thumbUpload: null,
        },
      })),
    });
    const pdf = new File(["%PDF-1.7\n"], "estimate.pdf", { type: "application/pdf" });
    await uploadFile(pdf, { kind: "claim_document", parentId: "c1" }, deps);
    expect(deps.createUpload).toHaveBeenCalledWith({
      kind: "claim_document",
      parentId: "c1",
      mime: "application/pdf",
      sizeBytes: pdf.size,
    });
    expect(vi.mocked(deps.put).mock.calls[0]![1]).toBe(pdf);
  });

  it("refuses an over-10 MB photo without asking the server", async () => {
    const deps = fakeDeps();
    const big = new File([new Uint8Array(11 * MB)], "big.jpg", { type: "image/jpeg" });
    await expect(uploadFile(big, { kind: "claim_photo", parentId: "c1" }, deps)).rejects.toThrow(
      UPLOAD_COPY.tooBig,
    );
    expect(deps.createUpload).not.toHaveBeenCalled();
    expect(deps.put).not.toHaveBeenCalled();
  });

  it("shows the server's refusal as it is", async () => {
    const deps = fakeDeps({
      createUpload: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "VALIDATION" as const,
          message: "This claim already has 10 photos.",
          fields: {},
        },
      })),
    });
    const call = uploadFile(await photo(), { kind: "claim_photo", parentId: "c1" }, deps);
    await expect(call).rejects.toBeInstanceOf(UploadError);
    await expect(call).rejects.toThrow("This claim already has 10 photos.");
    expect(deps.put).not.toHaveBeenCalled();
  });
});
