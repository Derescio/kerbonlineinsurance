import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server";

import type { WriteResult } from "#/lib/validation";
import { actorMiddleware, userMiddleware } from "#/server/auth/middleware";
import type { RecordsOnFile } from "#/server/data/account";

// The server functions behind /account/close and the closure banner (4.7). The work is in
// src/server/account/ (delete, closure) and src/server/data/account.ts; these only resolve the
// actor and hand over. Server modules are imported inside the handlers, which the client build
// strips, so the database stays server-side.

export type ClosePageData =
  | { kind: "staff" }
  | { kind: "delete"; providers: string[]; twoFactor: boolean }
  | {
      kind: "close";
      records: RecordsOnFile;
      providers: string[];
      twoFactor: boolean;
      openClaim: string | null;
      /** ISO time the window would end if the customer asked now, for "keep your account before…" */
      closesOn: string;
    }
  | { kind: "closing"; closesAt: string; held: boolean };

export interface ClosureBannerData {
  closesAt: string;
  held: boolean;
}

const noStore = () => setResponseHeader("Cache-Control", "private, no-store");

/** Which version of /account/close this user sees */
export const getClosePage = createServerFn({ method: "GET" })
  .middleware([userMiddleware])
  .handler(async ({ context }): Promise<ClosePageData> => {
    noStore();
    const [{ getAuth }, data, { CLOSURE_WINDOW_DAYS }] = await Promise.all([
      import("#/server/auth/auth"),
      import("#/server/data/account"),
      import("#/server/account/constants"),
    ]);
    const { actor } = context;
    const userId = actor.userId;
    const [staff, state, records, openClaim] = await data.withAccountTx(async (tx) => [
      await data.hasStaffRow(tx, userId),
      await data.getAccountState(tx, userId),
      await data.recordsOnFile(tx, userId),
      await data.openClaimReference(tx, userId),
    ]);
    if (staff) return { kind: "staff" };
    if (state.kind === "closure_requested") {
      return { kind: "closing", closesAt: state.closesAt.toISOString(), held: !!state.heldSince };
    }
    const accounts = await getAuth().api.listUserAccounts({ headers: getRequestHeaders() });
    const providers = accounts.map((account) => account.providerId);
    const twoFactor = actor.twoFactor.enabled;
    if (!data.hasRecordsOnFile(records)) return { kind: "delete", providers, twoFactor };
    const closesOn = new Date(Date.now() + CLOSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return {
      kind: "close",
      records,
      providers,
      twoFactor,
      openClaim,
      closesOn: closesOn.toISOString(),
    };
  });

/** The banner's data, or null when signed out or nothing is open. Never cached */
export const getClosureBanner = createServerFn({ method: "GET" })
  .middleware([actorMiddleware])
  .handler(async ({ context }): Promise<ClosureBannerData | null> => {
    noStore();
    const { actor } = context;
    if (!actor) return null;
    const data = await import("#/server/data/account");
    const state = await data.withAccountTx((tx) => data.getAccountState(tx, actor.userId));
    if (state.kind !== "closure_requested") return null;
    return { closesAt: state.closesAt.toISOString(), held: !!state.heldSince };
  });

export interface ConfirmEnvelope {
  input: { password?: string; code?: string };
  idempotencyKey?: string;
}

const confirmEnvelope = (data: ConfirmEnvelope) => data;
const keepEnvelope = (data: { input: Record<string, never>; idempotencyKey: string }) => data;

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator(confirmEnvelope)
  .handler(async ({ context, data }): Promise<WriteResult<{ deleted: true }>> => {
    const { deleteAccount } = await import("#/server/account/delete");
    const headers = getRequestHeaders();
    const result = await deleteAccount(context.actor, data, { headers });
    if (result.ok) {
      const { clearSessionCookies } = await import("#/server/account/delete");
      // The session row went with the user; this expires the browser's cookies
      await clearSessionCookies(headers).catch(() => undefined);
    }
    return result;
  });

export const requestMyClosure = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator(confirmEnvelope)
  .handler(async ({ context, data }): Promise<WriteResult<{ closesAt: string }>> => {
    const { requestClosure } = await import("#/server/account/closure");
    return requestClosure(context.actor, data, { headers: getRequestHeaders() });
  });

export const keepMyAccount = createServerFn({ method: "POST" })
  .middleware([actorMiddleware])
  .validator(keepEnvelope)
  .handler(async ({ context, data }): Promise<WriteResult<{ kept: true }>> => {
    const { cancelClosure } = await import("#/server/account/closure");
    return cancelClosure(context.actor, data, { headers: getRequestHeaders() });
  });
