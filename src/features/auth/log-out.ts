import { leaveTo } from "#/lib/leave";

import { authClient } from "./auth-client";

// Logging out from a menu (6.1). A failure stays on the page: the session is still there, so
// going home would only hide that.

export const LOG_OUT_FAILED = "We couldn’t log you out. Try again in a minute.";

/** Ends the session and loads the home page. The failure sentence when it doesn't. */
export async function logOutHome(): Promise<string | null> {
  try {
    const { error } = await authClient.signOut();
    if (error) return LOG_OUT_FAILED;
  } catch {
    return LOG_OUT_FAILED;
  }
  leaveTo("/");
  return null;
}
