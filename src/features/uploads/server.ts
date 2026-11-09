import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server";

import type { WriteResult } from "#/lib/validation";
import { actorMiddleware, permissionMiddleware, userMiddleware } from "#/server/auth/middleware";
import type {
  CreateUploadInput,
  FileLink,
  MyClaimFile,
  StaffClaimFiles,
  UploadResult,
  UploadTicket,
} from "#/server/data/files";

// The server functions behind /dev/uploads (4.10, decision 4), a test page that is never in
// production. Each hands over to src/server/data/files.ts, which does every check; these only
// resolve the actor. Server modules are imported inside the handlers, which the client build
// strips, so the database stays server-side.

export interface UploadsTestClaim {
  id: string;
  reference: string;
  status: string;
  acceptsUploads: boolean;
  files: MyClaimFile[];
}

export interface UploadsTestPageData {
  /** Whether to show the staff box (the staff reads re-check the permission) */
  staff: boolean;
  claims: UploadsTestClaim[];
}

/** The test page and its functions 404 in production (VERCEL_TARGET_ENV is set by Vercel) */
function devOnly(): void {
  if (process.env.VERCEL_TARGET_ENV === "production") throw notFound();
  setResponseHeader("Cache-Control", "private, no-store");
}

export const getUploadsTestPage = createServerFn({ method: "GET" })
  .middleware([userMiddleware])
  .handler(async ({ context }): Promise<UploadsTestPageData> => {
    devOnly();
    const [data, { OPEN_CLAIM_STATUSES }] = await Promise.all([
      import("#/server/data"),
      import("#/server/account/constants"),
    ]);
    const { actor } = context;
    const open: readonly string[] = ["draft", ...OPEN_CLAIM_STATUSES];
    const claims = await data.listMyClaims(actor, {});
    return {
      staff: actor.staff?.permissions.has("claims.read_all") ?? false,
      claims: await Promise.all(
        claims.map(async (claim) => ({
          id: claim.id,
          reference: claim.reference,
          status: claim.status,
          acceptsUploads: open.includes(claim.status),
          files: await data.listMyClaimFiles(actor, { claimId: claim.id }),
        })),
      ),
    };
  });

export const createMyUpload = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((input: CreateUploadInput) => input)
  .handler(async ({ context, data }): Promise<WriteResult<UploadTicket>> => {
    devOnly();
    const { createUpload } = await import("#/server/data/files");
    return createUpload(context.actor, { input: data }, { headers: getRequestHeaders() });
  });

export const confirmMyUpload = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator((input: { fileId: string }) => input)
  .handler(async ({ context, data }): Promise<WriteResult<UploadResult>> => {
    devOnly();
    const { confirmUpload } = await import("#/server/data/files");
    return confirmUpload(context.actor, { input: data }, { headers: getRequestHeaders() });
  });

export const openMyFile = createServerFn({ method: "GET" })
  .middleware([userMiddleware])
  .validator((input: { fileId: string }) => input)
  .handler(async ({ context, data }): Promise<FileLink> => {
    devOnly();
    const { getMyFileUrl } = await import("#/server/data/files");
    return getMyFileUrl(context.actor, data);
  });

export const staffClaimFiles = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("claims.read_all")])
  .validator((input: { reference: string }) => input)
  .handler(async ({ context, data }): Promise<StaffClaimFiles> => {
    devOnly();
    const { staffListClaimFiles } = await import("#/server/data/files");
    return staffListClaimFiles(context.actor, data);
  });

export const staffOpenFile = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("claims.read_all")])
  .validator((input: { fileId: string }) => input)
  .handler(async ({ context, data }): Promise<FileLink> => {
    devOnly();
    const { staffGetFileUrl } = await import("#/server/data/files");
    return staffGetFileUrl(context.actor, data);
  });
