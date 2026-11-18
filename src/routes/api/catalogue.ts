import { createFileRoute } from "@tanstack/react-router";

import { catalogueResponse } from "#/server/quote/catalogue";

// The car picker's catalogue (5.2, call 13), cached long on the CDN
export const Route = createFileRoute("/api/catalogue")({
  server: {
    handlers: { GET: () => catalogueResponse() },
  },
});
