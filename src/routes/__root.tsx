import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "#/styles.css?url";
// The two above-the-fold fonts. Same files as src/styles/fonts.css, so Vite emits one hashed asset each.
import bricolageFont from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2?url";
import instrumentSansFont from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";

const fontPreloads = [bricolageFont, instrumentSansFont].map((href) => ({
  rel: "preload",
  href,
  as: "font",
  type: "font/woff2",
  crossOrigin: "anonymous" as const,
}));

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Kerb",
      },
    ],
    links: [
      ...fontPreloads,
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/png", href: "/icon-192.png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}

        <Scripts />
      </body>
    </html>
  );
}
