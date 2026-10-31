import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "#/features/landing/LandingPage";

export const Route = createFileRoute("/_site/")({ component: LandingPage });
