import type { Auth } from "./auth";

// "Is anyone signed in?" for the public header (6.1, decision 8). The public pages are CDN-cached
// (4.4, decision 7), so the header asks this after it loads instead. Never cached, and it says
// nothing about who: a session still owing a 2FA code counts, since the answer only picks a label.

export async function sessionHintResponse(headers: Headers, auth?: Auth): Promise<Response> {
  const { getAuth } = await import("./auth");
  const session = await (auth ?? getAuth()).api.getSession({ headers }).catch(() => null);
  return Response.json(
    { signedIn: session !== null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
