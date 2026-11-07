import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { focusFirstError } from "#/lib/validation";

import { authClient, safeRedirect } from "../auth-client";
import { AuthShell } from "../AuthShell";
import { SOMETHING_WENT_WRONG, useHydrated } from "../form";
import { TOO_MANY_TRIES } from "../LoginForm";
import { isBackupCode, isTotp, normaliseBackupCode, normaliseTotp } from "./codes";
import {
  CodeInput,
  ENTER_BACKUP_CODE,
  ENTER_CODE,
  notYouTopBar,
  settle,
  verifyOutcome,
  WRONG_BACKUP_CODE,
  WRONG_CODE,
} from "./parts";

// The two-factor challenge (Figma 09, 09b wrong code, 09b too many tries, 10 backup code). Two
// modes share it: sign-in mode after an email and password (via=email; no session yet, only the
// two_factor cookie), and a session that owes a code (a Google sign-in, or staff, call 14).
// Nothing here reads Better Auth's cached session; it moves on only after a 2xx verify.

type Mode = "totp" | "backup";

type Notice = { tone: "warning" | "danger"; title: string; message: string };

export function ChallengeForm({
  redirect,
  via,
  trust,
  mode: initialMode = "totp",
}: {
  /** Where to go after the code, checked with safeRedirect (Review Focus 4) */
  redirect?: string;
  via?: "email";
  /** The server's kerbTrustDevice: false for staff (call 8) */
  trust?: boolean;
  mode?: Mode;
}) {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [totp, setTotp] = useState("");
  const [backup, setBackup] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [locked, setLocked] = useState(false);
  const [usedUp, setUsedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  // The box only means something after an email sign-in: Better Auth honours the trust cookie
  // there and nowhere else (call 8)
  const showTrust = via === "email" && trust === true;

  function switchMode(next: Mode) {
    setMode(next);
    setError(undefined);
    setNotice(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = mode === "totp" ? normaliseTotp(totp) : normaliseBackupCode(backup);
    if (mode === "totp" ? !isTotp(code) : !isBackupCode(code)) {
      setError(mode === "totp" ? ENTER_CODE : ENTER_BACKUP_CODE);
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(null);
    // Never disableSession (the server refuses it); trustDevice only where the box is shown
    const body = showTrust && data.get("trust") === "on" ? { code, trustDevice: true } : { code };
    const failure = await settle(() =>
      mode === "totp"
        ? authClient.twoFactor.verifyTotp(body)
        : authClient.twoFactor.verifyBackupCode(body),
    );
    setBusy(false);
    if (!failure) {
      await navigate({ href: safeRedirect(redirect) });
      return;
    }
    const outcome = verifyOutcome(failure);
    if (outcome === "wrong") {
      // 09b keeps the digits, in red, so a typo can be seen
      setError(mode === "totp" ? WRONG_CODE : WRONG_BACKUP_CODE);
      focusFirstError(form.current);
    } else if (outcome === "locked") {
      setNotice(TOO_MANY_TRIES);
      setLocked(true);
    } else if (outcome === "used_up") {
      setUsedUp(true);
    } else {
      setNotice({
        tone: "danger",
        title: "We couldn't check your code",
        message: SOMETHING_WENT_WRONG,
      });
    }
  }

  if (usedUp) {
    return (
      <AuthShell
        topBar={notYouTopBar}
        title="Sign in again"
        subtitle="For your security, we've stopped accepting codes for this sign-in."
      >
        <div className="auth__form">
          <Alert tone="warning" title="Too many tries" announce>
            Sign in again.
          </Alert>
          <Link to="/login" className="kb-btn kb-btn--primary kb-btn--lg kb-btn--full">
            <span>Back to log in</span>
          </Link>
        </div>
      </AuthShell>
    );
  }

  const backupMode = mode === "backup";
  return (
    <AuthShell
      topBar={notYouTopBar}
      title={backupMode ? "Use a backup code" : "Enter your code"}
      subtitle={
        backupMode
          ? "Enter one of the codes you saved when you set up two-factor."
          : "Open your authenticator app and enter the 6-digit code for Kerb."
      }
    >
      <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
        {notice ? (
          <Alert tone={notice.tone} title={notice.title} announce>
            {notice.message}
          </Alert>
        ) : null}
        {backupMode ? (
          <Input
            label="Backup code"
            name="backup"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            hint="Each backup code works once."
            value={backup}
            onChange={(event) => {
              setBackup(event.target.value);
              setError(undefined);
            }}
            error={error}
            disabled={locked}
          />
        ) : (
          <CodeInput
            value={totp}
            onChange={(next) => {
              setTotp(next);
              setError(undefined);
            }}
            error={error}
            disabled={locked}
          />
        )}
        {showTrust && !backupMode ? (
          <Checkbox
            name="trust"
            label="Trust this device for 30 days"
            description="Skip this step next time. Not on a shared computer."
            disabled={locked}
          />
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!hydrated || locked}
        >
          Verify
        </Button>
        <button
          type="button"
          className="auth__link auth__link-button"
          onClick={() => switchMode(backupMode ? "totp" : "backup")}
        >
          {backupMode ? "Use your authenticator app instead" : "Use a backup code instead"}
        </button>
      </form>
    </AuthShell>
  );
}
