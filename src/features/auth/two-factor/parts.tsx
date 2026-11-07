import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { Button } from "#/components/actions/Button";
import { describedBy, FieldMessage } from "#/components/forms/Field";
import { cx } from "#/lib/cx";

import { authClient } from "../auth-client";
import type { AuthTopBarAction } from "../AuthShell";
import type { AuthError } from "../form";
import { normaliseTotp, TOTP_LENGTH } from "./codes";

// Parts shared by the two-factor screens (4.6, frames 09–13).

export const WRONG_CODE =
  "That code didn't work. Codes change every 30 seconds, so use the newest one.";
export const WRONG_BACKUP_CODE = "That backup code didn't work. Check it, or try another one.";
export const ENTER_CODE = "Enter the 6-digit code from your app.";
export const ENTER_BACKUP_CODE = "Enter a backup code, like 7KQ2M-X9PLD.";

/**
 * What a failed code check means for the screen. Nothing here ever moves on: only a 2xx does.
 * - wrong: 401 INVALID_CODE / INVALID_BACKUP_CODE
 * - locked: 429, the account's 15-minute lockout or the verify rate limit (call 9)
 * - used_up: the sign-in challenge is spent or gone (5 tries, or no two_factor cookie), or 2FA
 *   was turned off meanwhile: only signing in again helps
 * - failed: anything else, a 5xx included (a 500 may still have set a cookie; we stay put)
 */
export type VerifyOutcome = "wrong" | "locked" | "used_up" | "failed";

const USED_UP = new Set([
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
  "INVALID_TWO_FACTOR_COOKIE",
  "TWO_FACTOR_NOT_ENABLED",
]);

export function verifyOutcome(error: AuthError): VerifyOutcome {
  if (error.code === "INVALID_CODE" || error.code === "INVALID_BACKUP_CODE") return "wrong";
  if (error.status === 429) return "locked";
  if (error.code && USED_UP.has(error.code)) return "used_up";
  return "failed";
}

/** The fetch never throwing a network error into the form: it becomes a "failed" */
export async function settle(call: () => Promise<{ error: AuthError | null }>) {
  try {
    return (await call()).error;
  } catch {
    return { status: 0 } satisfies AuthError;
  }
}

/** "Log out" in the two-factor screens' top bar. Signs out whatever is there, then goes to log in */
function LogOutButton() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function logOut() {
    setBusy(true);
    // In sign-in mode there's no session to end yet; going to /login is all that's needed
    await settle(() => authClient.signOut());
    await navigate({ to: "/login" });
  }
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={logOut}>
      Log out
    </Button>
  );
}

export const notYouTopBar: AuthTopBarAction = { text: "Not you?", action: <LogOutButton /> };

/**
 * Auth / Code input (203:4463): six boxes over one real input (inputmode=numeric,
 * autocomplete=one-time-code), so typing, pasting and the phone's code suggestion all just work.
 * Without a visible label it's named "6-digit code".
 */
export function CodeInput({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const active = Math.min(value.length, TOTP_LENGTH - 1);
  return (
    <div className="kb-field">
      {label ? (
        <label className="kb-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div
        className={cx("auth-code", error && "auth-code--error", disabled && "auth-code--disabled")}
      >
        <input
          id={id}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          className="auth-code__input"
          aria-label={label ? undefined : "6-digit code"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { error })}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(normaliseTotp(event.target.value).slice(0, TOTP_LENGTH))}
        />
        {Array.from({ length: TOTP_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cx("auth-code__box", index === active && "auth-code__box--active")}
          >
            {value[index] ?? ""}
          </span>
        ))}
      </div>
      <FieldMessage id={id} error={error} />
    </div>
  );
}

/** Copy to the clipboard, with "Copied" on the button for a moment */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions); the text is on screen to copy by hand
    }
  }
  return (
    <>
      <Button variant="secondary" size="sm" iconLeft={copied ? "check" : "copy"} onClick={copy}>
        {label}
      </Button>
      <span role="status" className="kb-sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
