import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createServer, createServerModuleRunner } from "vite-plus";

// Proves the R2 store against the real bucket in .env.local (4.10, call 13):
//   vp run uploads:check-r2
// One small object under check/: a signed PUT with fetch (as the browser does), then head, read
// the first bytes, a signed GET with fetch, and delete. One line per step, `ok` or the error's
// name; never a key, a link or a credential. The object is deleted even when a step fails.

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "error",
  resolve: { tsconfigPaths: true },
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

let failed = false;
async function step(name: string, run: () => Promise<boolean | void>): Promise<void> {
  try {
    const ok = (await run()) !== false;
    console.log(`${ok ? "ok    " : "FAILED"} ${name}`);
    if (!ok) failed = true;
  } catch (error) {
    failed = true;
    const label = error instanceof Error ? error.name : typeof error;
    console.log(`FAILED ${name} (${label})`);
  }
}

try {
  const env = await runner.import<typeof import("../src/server/env.ts")>("/src/server/env.ts");
  const { R2ObjectStore } = await runner.import<typeof import("../src/server/uploads/store-r2.ts")>(
    "/src/server/uploads/store-r2.ts",
  );
  const { detectType } = await runner.import<typeof import("../src/server/uploads/magic.ts")>(
    "/src/server/uploads/magic.ts",
  );

  const r2 = env.getR2Env();
  console.log(`Bucket: ${r2.R2_BUCKET}`);
  const store = new R2ObjectStore(r2);
  const key = `check/${randomUUID()}.webp`;
  const body = new TextEncoder().encode("RIFF\x24\0\0\0WEBPVP8 \0\0\0\0");

  await step("signed PUT", async () => {
    const url = await store.presignPut(key, {
      contentType: "image/webp",
      contentLength: body.length,
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "image/webp" },
      body,
    });
    return response.ok;
  });
  await step("a PUT of another type is refused", async () => {
    const url = await store.presignPut(`check/${randomUUID()}.webp`, {
      contentType: "image/webp",
      contentLength: body.length,
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/html" },
      body,
    });
    return !response.ok;
  });
  await step("head", async () => (await store.head(key))?.size === body.length);
  await step("first bytes are WebP", async () => {
    return detectType(await store.readFirstBytes(key, 16)) === "image/webp";
  });
  await step("signed GET", async () => {
    const response = await fetch(await store.presignGet(key));
    return response.ok && (await response.arrayBuffer()).byteLength === body.length;
  });
  await step("delete", async () => {
    await store.delete(key);
    return (await store.head(key)) === null;
  });
} catch (error) {
  failed = true;
  // R2ConfigError names the missing variables, never their values
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Failed.");
} finally {
  await runner.close().catch(() => {});
  await server.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
