// What a file really is, from its first bytes (4.10). A renamed .exe or an HTML page is null,
// whatever its name or declared type says.

export type Detected = "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;

/** How many bytes the server reads from the start of an uploaded object */
export const MAGIC_BYTES = 16;

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  bytes.length >= start + text.length &&
  [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));

export function detectType(bytes: Uint8Array): Detected {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, "PNG\r\n\x1a\n")) {
    return "image/png";
  }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  if (ascii(bytes, 0, "%PDF-")) return "application/pdf";
  return null;
}
