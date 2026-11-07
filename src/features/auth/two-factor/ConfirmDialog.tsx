import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Dialog } from "#/components/feedback/Dialog";
import { Input } from "#/components/forms/Input";
import { focusFirstError } from "#/lib/validation";

import { authClient } from "../auth-client";
import { SOMETHING_WENT_WRONG } from "../form";
import { TOO_MANY_TRIES } from "../LoginForm";
import { isBackupCode, isTotp, normaliseBackupCode, normaliseTotp } from "./codes";
import {
  CodeInput,
  ENTER_BACKUP_CODE,
  ENTER_CODE,
  settle,
  verifyOutcome,
  WRONG_BACKUP_CODE,
  WRONG_CODE,
} from "./parts";

// "Confirm it's you" (Figma 13): a fresh code before a sensitive staff action. 6.10 and 6.11 open
// it; a right code stamps the session (call 4), so requireFresh then lets the action through. It
// checks the code in signed-in mode, so the lockout hooks count wrong ones (call 9).

type Mode = "totp" | "backup";

export function ConfirmDialog({
  open,
  onConfirmed,
  onCancel,
  description = "Enter the 6-digit code from your authenticator app to continue.",
}: {
  open: boolean;
  onConfirmed: () => void;
  onCancel: () => void;
  /** What the code approves, e.g. "…to approve this payout." (frame 13) */
  description?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const formId = useId();
  const [mode, setMode] = useState<Mode>("totp");
  const [totp, setTotp] = useState("");
  const [backup, setBackup] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{
    tone: "warning" | "danger";
    title: string;
    message: string;
  } | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    setTotp("");
    setBackup("");
    setError(undefined);
    setNotice(null);
    setMode("totp");
    onCancel();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = mode === "totp" ? normaliseTotp(totp) : normaliseBackupCode(backup);
    if (mode === "totp" ? !isTotp(code) : !isBackupCode(code)) {
      setError(mode === "totp" ? ENTER_CODE : ENTER_BACKUP_CODE);
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(null);
    const failure = await settle(() =>
      mode === "totp"
        ? authClient.twoFactor.verifyTotp({ code })
        : authClient.twoFactor.verifyBackupCode({ code }),
    );
    setBusy(false);
    if (!failure) {
      setTotp("");
      setBackup("");
      onConfirmed();
      return;
    }
    const outcome = verifyOutcome(failure);
    if (outcome === "wrong") {
      setError(mode === "totp" ? WRONG_CODE : WRONG_BACKUP_CODE);
      focusFirstError(form.current);
    } else if (outcome === "locked") {
      setNotice(TOO_MANY_TRIES);
      setLocked(true);
    } else {
      setNotice({
        tone: "danger",
        title: "We couldn't check your code",
        message: SOMETHING_WENT_WRONG,
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Confirm it's you"
      description={mode === "totp" ? description : "Enter one of the backup codes you saved."}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={locked}>
            Confirm
          </Button>
        </>
      }
    >
      <form
        ref={form}
        id={formId}
        method="post"
        className="auth__form"
        noValidate
        onSubmit={onSubmit}
      >
        {notice ? (
          <Alert tone={notice.tone} title={notice.title} announce>
            {notice.message}
          </Alert>
        ) : null}
        {mode === "totp" ? (
          <CodeInput
            value={totp}
            onChange={(next) => {
              setTotp(next);
              setError(undefined);
            }}
            error={error}
            disabled={locked}
          />
        ) : (
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
        )}
        <button
          type="button"
          className="auth__link auth__link-button"
          onClick={() => {
            setMode(mode === "totp" ? "backup" : "totp");
            setError(undefined);
          }}
        >
          {mode === "totp" ? "Use a backup code" : "Use your authenticator app"}
        </button>
      </form>
    </Dialog>
  );
}
