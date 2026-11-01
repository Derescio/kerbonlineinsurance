import { HeadContent, Scripts, createRootRoute, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { Toaster } from "#/components/feedback/Toaster";
import { ConsentBanner } from "#/components/site/ConsentBanner";
import { NotFound } from "#/components/site/NotFound";
import { AppErrorBoundary } from "#/components/site/AppErrorBoundary";
import { startAnalytics } from "#/lib/analytics";
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
  notFoundComponent: SiteNotFound,
});

function SiteNotFound() {
  const { pathname } = useLocation();
  return <NotFound pathname={pathname} />;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // PostHog loads once the page is idle after hydration, outside the landing JS budget (3.5)
  useEffect(startAnalytics, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppErrorBoundary>
          <Toaster>{children}</Toaster>
        </AppErrorBoundary>
        <ConsentBanner />

        <Scripts />
      </body>
    </html>
  );
}
