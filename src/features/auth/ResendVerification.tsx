import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { authClient } from "./auth-client";
import { formText, TOO_FAST, useHydrated } from "./form";
import { BackToLogIn } from "./PasswordResetForms";
import { forgotPasswordSchema } from "./schemas";

// Getting a new confirmation link (4.4b). An unconfirmed account can't log in, so every resend
// happens without a session: Better Auth answers the same whether or not the email has an
// unconfirmed account, and allows 3 per 15 minutes.

export const LINK_HOURS = 6;
const RESEND_WAIT_SECONDS = 60;

type ResendState = "idle" | "sending" | "sent" | "failed";

function sendLink(email: string) {
  return authClient.sendVerificationEmail({ email, callbackURL: "/email-confirmed" });
}

function useResend(email: string) {
  const [state, setState] = useState<ResendState>("idle");
  const [wait, setWait] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function resend() {
    setState("sending");
    const { error } = await sendLink(email);
    if (error) {
      setState("failed");
      setFailure(error.status === 429 ? TOO_FAST : "We couldn't send it. Try again in a minute.");
      return;
    }
    setState("sent");
    setWait(RESEND_WAIT_SECONDS);
  }

  return { state, wait, failure, resend };
}

/**
 * An Alert with a Resend button and its 60-second countdown: "Check your inbox" after sign-up
 * (03c) and "Confirm your email first" on login (02c).
 */
export function ResendVerificationAlert({
  email,
  title,
  children,
  announce = true,
}: {
  email: string;
  title: string;
  children: string;
  announce?: boolean;
}) {
  const { state, wait, failure, resend } = useResend(email);
  const message =
    state === "sent"
      ? "Sent. It can take a minute to arrive. Check your spam folder too."
      : state === "failed" && failure
        ? failure
        : children;

  return (
    <Alert
      tone="info"
      title={title}
      announce={announce || state !== "idle"}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={resend}
          loading={state === "sending"}
          disabled={wait > 0}
        >
          {wait > 0 ? `Resend in ${wait}s` : "Resend email"}
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/** 07d: the link has expired, so ask for the email and send a fresh one */
export function SendNewLinkForm() {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = fieldErrors(forgotPasswordSchema, { email: formText(data, "email") });
    setError(checked.errors?.email);
    if (checked.errors) {
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setNotice(null);
    const { error: failure } = await sendLink(checked.data.email);
    setBusy(false);
    if (!failure) return setSent(true);
    setNotice(failure.status === 429 ? TOO_FAST : "We couldn't send it. Try again in a minute.");
  }

  if (sent) {
    return (
      <div className="auth__form">
        <Alert tone="success" title="New link sent" announce>
          {`If there's an unconfirmed account for that email, you'll get a link in the next few minutes. It works for ${LINK_HOURS} hours.`}
        </Alert>
        <BackToLogIn />
      </div>
    );
  }

  return (
    <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
      {notice ? (
        <Alert tone="danger" title="We couldn't send the link" announce>
          {notice}
        </Alert>
      ) : null}
      <Input
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        iconLeft="mail"
        onChange={() => setError(undefined)}
        error={error}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!hydrated}
      >
        Send a new link
      </Button>
      <BackToLogIn variant="ghost" />
    </form>
  );
}
