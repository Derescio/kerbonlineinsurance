import { useQuery } from "@tanstack/react-query";

import { getSessionUser } from "#/features/auth/session";

// Where the gate goes when the tab holds no journey (5.6, decision 9; 5.7 manual check): a paid
// quote clears it, and a confirm-email link opens a new tab (or, on a preview, another URL) that
// never had it. A signed-in visitor's quote was saved at sign-up, so they go to Your saved
// quotes; a guest starts again. A session check that fails counts as a guest.

export type RestartTo = "start" | "retrieve";

export async function restartTarget(): Promise<RestartTo> {
  try {
    return (await getSessionUser()) ? "retrieve" : "start";
  } catch {
    return "start";
  }
}

/** Whether someone is signed in, as the gate reads it (one shared query) */
export function useSignedIn(): boolean {
  const session = useQuery({
    queryKey: ["session-user"],
    queryFn: () => getSessionUser(),
    staleTime: 0,
    retry: false,
  });
  return Boolean(session.data);
}
