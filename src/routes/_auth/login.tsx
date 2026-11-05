import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { safeRedirect } from "#/features/auth/auth-client";
import { AuthShell } from "#/features/auth/AuthShell";
import { LoginForm } from "#/features/auth/LoginForm";
import { getSessionUser } from "#/features/auth/session";
import { useOneTimeToast } from "#/features/auth/use-one-time-toast";

const search = z.object({
  redirect: z.string().optional().catch(undefined),
  // Better Auth's error code when Google sign-in fails or is refused (frames 08, 08b)
  error: z.string().optional().catch(undefined),
  reset: z.literal("done").optional().catch(undefined),
});

export const Route = createFileRoute("/_auth/login")({
  validateSearch: search,
  // Already signed in: straight on (decision 7)
  beforeLoad: async ({ search: { redirect: to } }) => {
    if (await getSessionUser()) throw redirect({ href: safeRedirect(to) });
  },
  head: () => ({ meta: [{ title: "Log in · Kerb" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect: to, error, reset } = Route.useSearch();
  const navigate = useNavigate();
  useOneTimeToast(
    reset === "done"
      ? { tone: "success", title: "Password changed", message: "Log in with your new password." }
      : null,
    () => void navigate({ to: "/login", search: { redirect: to }, replace: true }),
  );
  // Better Auth sends ?error=…&error_description=… back from Google. LoginForm keeps the notice in
  // state, so the URL goes back to plain /login (Better Auth's description isn't ours to show).
  useEffect(() => {
    if (error) void navigate({ to: "/login", search: { redirect: to }, replace: true });
  }, [error, to, navigate]);
  return (
    <AuthShell
      topBar={{ text: "New to Kerb?", to: "/signup", label: "Create account" }}
      title="Log in to Kerb"
    >
      <LoginForm redirectTo={safeRedirect(to)} error={error} />
    </AuthShell>
  );
}
