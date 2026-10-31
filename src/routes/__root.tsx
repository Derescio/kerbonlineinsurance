import { PostHogErrorBoundary, PostHogProvider } from "@posthog/react";
import { HeadContent, Scripts, createRootRoute, useLocation } from "@tanstack/react-router";

import { Toaster } from "#/components/feedback/Toaster";
import { NotFound } from "#/components/site/NotFound";
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
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PostHogContent>
          <Toaster>{children}</Toaster>
        </PostHogContent>

        <Scripts />
      </body>
    </html>
  );
}

const posthogProjectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

// Analytics is optional: without the two variables the site runs as normal, just untracked.
if (import.meta.env.DEV && (!posthogProjectToken || !posthogHost)) {
  console.warn(
    "PostHog is off: set VITE_PUBLIC_POSTHOG_PROJECT_TOKEN and VITE_PUBLIC_POSTHOG_HOST in .env.local to send events.",
  );
}

const posthogOptions = {
  api_host: posthogHost,
  defaults: "2025-05-24",
  capture_exceptions: true,
  debug: import.meta.env.DEV,
  // Replay records layout and clicks only: inputs and all page text are masked, because quote and
  // policy pages show names, addresses and vehicle details. Wins over the dashboard's masking.
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: "*",
  },
  logs: {
    serviceName: "kerb-online-insurance-web",
    environment: import.meta.env.MODE,
  },
} as const;

function PostHogContent({ children }: { children: React.ReactNode }) {
  if (!posthogProjectToken || !posthogHost) return children;

  return (
    <PostHogProvider apiKey={posthogProjectToken} options={posthogOptions}>
      <PostHogErrorBoundary fallback={<GlobalErrorFallback />}>{children}</PostHogErrorBoundary>
    </PostHogProvider>
  );
}

function GlobalErrorFallback() {
  return <div role="alert">Something went wrong. Please refresh the page and try again.</div>;
}
