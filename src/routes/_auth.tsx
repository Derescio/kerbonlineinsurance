import { Outlet, createFileRoute } from "@tanstack/react-router";

// Pathless layout for the sign-in screens (4.4). They show per-visitor state, so they're never
// cached (plan/engineering.md section 9). Each page renders its own AuthShell.
export const Route = createFileRoute("/_auth")({
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: Outlet,
});
