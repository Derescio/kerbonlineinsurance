// Must stay the first import: it has to run before any route module builds a zod schema
import "./lib/zod-jitless";

import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

// TanStack Start's default client entry, plus the zod setting above
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
