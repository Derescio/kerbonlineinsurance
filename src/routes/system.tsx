import { createFileRoute } from "@tanstack/react-router";

import { SystemPage } from "./-system/SystemPage";
import systemCss from "./-system/system.css?url";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "Design system · Kerb" },
      // A reference page, not a landing page
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: systemCss }],
  }),
  component: SystemPage,
});
