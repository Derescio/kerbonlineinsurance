import { createFileRoute } from "@tanstack/react-router";

// Proves the host streams responses (Kerbie will need it). Sends one word every 300 ms.
const WORDS = "Kerb streams these words to you one at a time".split(" ");
const DELAY_MS = 300;

export const Route = createFileRoute("/api/stream-test")({
  server: {
    handlers: {
      GET: () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const word of WORDS) {
              controller.enqueue(encoder.encode(`${word}\n`));
              await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            // Stops proxies buffering the response
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
