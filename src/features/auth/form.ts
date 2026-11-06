import { useEffect, useState } from "react";

// Shared form plumbing for the auth screens.

/** Better Auth's client error, as much of it as the forms read */
export interface AuthError {
  status: number;
  code?: string;
  message?: string;
}

export const SOMETHING_WENT_WRONG = "Something went wrong on our side. Try again in a minute.";
export const TOO_FAST = "You're going a bit fast. Wait a few minutes, then try again.";
export const ROBOT_CHECK_FAILED =
  "The check that you're not a robot didn't work. Wait for it to finish, then try again.";

/**
 * False until React has hydrated. Submit buttons wait for it: a form submitted before the
 * JavaScript loads would go to the server natively, which these forms never should.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** A text field's value from FormData ("" when missing) */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
