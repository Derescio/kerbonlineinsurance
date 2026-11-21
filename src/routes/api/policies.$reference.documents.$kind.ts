import { createFileRoute } from "@tanstack/react-router";

// A policy's certificate or schedule, as a PDF for its owner only (6.2, decision 7). Server
// modules load inside the handler, so react-pdf and the database stay out of the browser bundle.
export const Route = createFileRoute("/api/policies/$reference/documents/$kind")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ getActor }, { policyDocumentResponse }] = await Promise.all([
          import("#/server/auth/actor"),
          import("#/server/documents/response"),
        ]);
        return policyDocumentResponse(await getActor(request.headers), params);
      },
    },
  },
});
