import { createFileRoute } from "@tanstack/react-router";

import { Hero } from "#/features/landing/Hero";

export const Route = createFileRoute("/_site/")({ component: Landing });

function Landing() {
  return <Hero />;
}
