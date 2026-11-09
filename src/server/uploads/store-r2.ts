import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { R2Env } from "#/server/env";

import { LINK_SECONDS } from "./limits";
import { r2Origin } from "./origin";
import type { ObjectStore } from "./store";

// Cloudflare R2 through its S3 API (4.10, call 13). Server-only. Path-style URLs on the account
// endpoint (`https://<id>.r2.cloudflarestorage.com/<bucket>/<key>`), so the CSP lists one origin.
// Checksums only when required: by default the SDK signs a CRC32 into PutObject, which a browser's
// plain PUT can't send.

export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: R2Env) {
    const endpoint = r2Origin(env.R2_ACCOUNT_ID);
    if (!endpoint) throw new Error("R2_ACCOUNT_ID is not 32 hex characters");
    this.bucket = env.R2_BUCKET;
    this.client = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  presignPut(key: string, opts: { contentType: string; contentLength: number }): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    // Signed as headers, so R2 refuses a body of another type or length
    return getSignedUrl(this.client, command, {
      expiresIn: LINK_SECONDS,
      signableHeaders: new Set(["content-type", "content-length"]),
      unhoistableHeaders: new Set(["content-type", "content-length"]),
    });
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: LINK_SECONDS,
    });
  }

  async head(key: string): Promise<{ size: number; contentType: string | null } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async readFirstBytes(key: string, count: number): Promise<Uint8Array> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${count - 1}` }),
    );
    if (!out.Body) return new Uint8Array();
    return (await out.Body.transformToByteArray()).slice(0, count);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
