import { renderToBuffer } from "@react-pdf/renderer";

import {
  documentFilename,
  isPolicyDocumentKind,
  policyDocuments,
} from "#/features/account/documents";
import { todayIso } from "#/features/quote/schemas/dates";
import { requireUser, type Actor } from "#/server/auth/actor";
import { AuthzError, RateLimitError } from "#/server/auth/errors";
import { getMyPolicy } from "#/server/data/policies";
import { limit, type RateRule } from "#/server/db/rate-limit";

import { registerDocumentFonts } from "./fonts";
import { PolicyDocument } from "./PolicyDocument";

// GET /api/policies/{reference}/documents/{certificate|schedule} (6.2, decision 7): made on
// request from the owner's own policy, never stored, never cached. Another customer's policy, and
// a document this policy doesn't have, are both 404. Reading your own documents writes no audit
// row; the limit stops PDF rendering being used to load the server.

export const DOCUMENT_LIMIT: RateRule = { max: 30, windowSeconds: 60 };

const NO_STORE = { "Cache-Control": "private, no-store" };

const refuse = (status: number) => new Response(null, { status, headers: NO_STORE });

export async function policyDocumentResponse(
  actor: Actor | null,
  params: { reference: string; kind: string },
  now: Date = new Date(),
): Promise<Response> {
  try {
    const known = requireUser(actor);
    await limit(`policy_document:user:${known.userId}`, DOCUMENT_LIMIT);
    if (!isPolicyDocumentKind(params.kind)) return refuse(404);
    const kind = params.kind;
    const policy = await getMyPolicy(known, { reference: params.reference });
    if (!policyDocuments(policy, todayIso(now)).includes(kind)) return refuse(404);
    registerDocumentFonts();
    const pdf = await renderToBuffer(<PolicyDocument kind={kind} policy={policy} />);
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${documentFilename(policy.reference, kind)}"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthzError) return refuse(error.status);
    if (error instanceof RateLimitError) return refuse(429);
    throw error;
  }
}
