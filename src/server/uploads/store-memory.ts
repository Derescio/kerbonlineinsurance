import type { ObjectStore } from "./store";

// The integration tests' object store (4.10, call 13). A signed link is `memory://put/<key>` or
// `memory://get/<key>`, so a test can see which key was signed; `put` stands in for the browser's
// upload.

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** Makes every delete throw, as if R2 were down */
  failDeletes = false;

  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }

  async presignPut(key: string): Promise<string> {
    return `memory://put/${key}`;
  }

  async presignGet(key: string): Promise<string> {
    return `memory://get/${key}`;
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { size: object.bytes.length, contentType: object.contentType } : null;
  }

  async readFirstBytes(key: string, count: number): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error("NoSuchKey");
    return object.bytes.slice(0, count);
  }

  async delete(key: string): Promise<void> {
    if (this.failDeletes) throw new Error("R2 is down");
    this.objects.delete(key);
  }
}
