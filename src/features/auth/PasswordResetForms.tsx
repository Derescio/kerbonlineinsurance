import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { describedBy } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError } from "#/lib/validation";

import { authClient, captchaHeaders } from "./auth-client";
import { formText, ROBOT_CHECK_FAILED, SOMETHING_WENT_WRONG, TOO_FAST, useHydrated } from "./form";
import { PasswordHint } from "./parts";
import { forgotPasswordSchema, resetPasswordSchema } from "./schemas";
import { BREACHED_PASSWORD_MESSAGE } from "./SignUpForm";
import { Turnstile } from "./Turnstile";

// Forgotten password (Figma 04, 05) and set a new password (06, 06b).

export function BackToLogIn({
  variant = "secondary",
}: {
  variant?: "secondary" | "primary" | "ghost";
}) {
  return (
    <Link to="/login" className={`kb-btn kb-btn--${variant} kb-btn--lg kb-btn--full`}>
      <span>Back to log in</span>
    </Link>
  );
}

export function ForgotPasswordForm() {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [robot, setRobot] = useState<string>();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = fieldErrors(forgotPasswordSchema, { email: formText(data, "email") });
    setError(checked.errors?.email);
    setRobot(token ? undefined : "Wait for the check above to finish, then try again.");
    if (checked.errors || !token) {
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setNotice(null);
    const { error: failure } = await authClient.requestPasswordReset(
      { email: checked.data.email, redirectTo: "/reset-password" },
      { headers: captchaHeaders(token) },
    );
    setBusy(false);
    setResetKey((key) => key + 1);
    if (!failure) return setSent(true);
    if (failure.status === 429) setNotice(TOO_FAST);
    else if (failure.status === 403) setNotice(ROBOT_CHECK_FAILED);
    else setNotice(SOMETHING_WENT_WRONG);
  }

  if (sent) {
    return (
      <div className="auth__form">
        <Alert tone="success" title="Reset link sent" announce>
          If there's an account for that email, you'll get a link in the next few minutes. It works
          for 1 hour.
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
      <div>
        <Turnstile
          resetKey={resetKey}
          onToken={(next) => {
            setToken(next);
            if (next) setRobot(undefined);
          }}
        />
        {robot ? (
          <p className="kb-field__error auth__inline-error" role="alert">
            {robot}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!hydrated}
      >
        Send reset link
      </Button>
      <Link to="/login" className="kb-btn kb-btn--ghost kb-btn--lg kb-btn--full">
        <span>Back to log in</span>
      </Link>
    </form>
  );
}

/** 06b: a reset link that's expired or already used (07d has its own form, SendNewLinkForm) */
export function LinkExpired({ again }: { again: "/forgot-password" }) {
  return (
    <div className="auth__form">
      <Link to={again} className="kb-btn kb-btn--primary kb-btn--lg kb-btn--full">
        <span>Send a new link</span>
      </Link>
      <BackToLogIn />
    </div>
  );
}

export function ResetPasswordForm({ token, onExpired }: { token: string; onExpired: () => void }) {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = fieldErrors(resetPasswordSchema, {
      password: formText(data, "password"),
    });
    if (checked.errors) {
      setError(checked.errors.password);
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setNotice(null);
    const { error: failure } = await authClient.resetPassword({
      newPassword: checked.data.password,
      token,
    });
    setBusy(false);
    if (!failure) {
      await navigate({ to: "/login", search: { reset: "done" } });
      return;
    }
    if (failure.code === "INVALID_TOKEN") onExpired();
    else if (failure.code === "PASSWORD_COMPROMISED") {
      setError(BREACHED_PASSWORD_MESSAGE);
      focusFirstError(form.current);
    } else setNotice(failure.status === 429 ? TOO_FAST : SOMETHING_WENT_WRONG);
  }

  return (
    <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
      {notice ? (
        <Alert tone="danger" title="We couldn't save your password" announce>
          {notice}
        </Alert>
      ) : null}
      <div className="auth__password">
        <Input
          id="reset-password"
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          iconLeft="lock"
          onChange={(event) => {
            setPassword(event.target.value);
            setError(undefined);
          }}
          error={error}
          aria-describedby={[describedBy("reset-password", { error }), "reset-password-hint"]
            .filter(Boolean)
            .join(" ")}
        />
        <PasswordHint id="reset-password-hint" password={password} />
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!hydrated}
      >
        Save password
      </Button>
    </form>
  );
}
