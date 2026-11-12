import { createFileRoute } from "@tanstack/react-router";

import { occupationsResponse } from "#/server/quote/occupations";

// The driver steps' occupation list (5.3, call 11), cached long on the CDN
export const Route = createFileRoute("/api/occupations")({
  server: {
    handlers: { GET: () => occupationsResponse() },
  },
});
