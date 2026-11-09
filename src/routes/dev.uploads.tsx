import { createFileRoute } from "@tanstack/react-router";

import { requireSignedIn } from "#/features/auth/guard";
import { getUploadsTestPage } from "#/features/uploads/server";
import { UploadsTestPage } from "#/features/uploads/UploadsTestPage";

// The upload test page (4.10, decision 4): the signed-in customer's claims with upload, progress,
// thumbnails and opening a file, plus a staff box. Never in production: getUploadsTestPage throws
// notFound() there, so the route 404s.
export const Route = createFileRoute("/dev/uploads")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  beforeLoad: async ({ location }) => {
    await requireSignedIn(location);
    return { page: await getUploadsTestPage() };
  },
  loader: ({ context }) => context.page,
  head: () => ({ meta: [{ title: "Upload test · Kerb" }, { name: "robots", content: "noindex" }] }),
  component: Uploads,
});

function Uploads() {
  return <UploadsTestPage data={Route.useLoaderData()} />;
}
