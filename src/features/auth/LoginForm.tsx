import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";

import { authClient } from "./auth-client";
import {
  fieldErrors,
  focusFirstError,
  formText,
  SOMETHING_WENT_WRONG,
  type FieldErrors,
  useHydrated,
} from "./form";
import { AuthDivider, GoogleButton } from "./parts";
import { ResendVerificationAlert } from "./ResendVerification";
import { signInSchema, type SignInInput } from "./schemas";

// Log in (Figma 01, 02, 02b, 02c, 08, 08b).

/** The code the server sends back when Google meets an account verified another way (decision 2) */
export const ACCOUNT_EXISTS_CODE = "ACCOUNT_EXISTS_VERIFIED";

/** A correct password on an email that isn't confirmed yet (4.4b) */
const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

type Notice = { tone: "info" | "warning" | "danger"; title: string; message: string } | null;

export function noticeForError(error: string | undefined): Notice {
  if (!error) return null;
  if (error === ACCOUNT_EXISTS_CODE) {
    return {
      tone: "info",
      title: "You already have a Kerb account",
      message: "Log in with your password, then connect Google from your account.",
    };
  }
  return {
    tone: "danger",
    title: "Google sign-in didn't work",
    message: "Try again, or log in with your email.",
  };
}

const TOO_MANY_TRIES: Notice = {
  tone: "warning",
  title: "Too many tries",
  message: "Wait 15 minutes and try again, or reset your password.",
};

export function LoginForm({ redirectTo, error }: { redirectTo: string; error?: string }) {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignInInput>>({});
  const [notice, setNotice] = useState<Notice>(() => noticeForError(error));
  const [locked, setLocked] = useState(false);
  // 02c: the email to send a new confirmation link to
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read from the form, not state: anything typed before hydration is still there
    const data = new FormData(event.currentTarget);
    const checked = fieldErrors(signInSchema, {
      email: formText(data, "email"),
      password: formText(data, "password"),
    });
    if (checked.errors) {
      setErrors(checked.errors);
      focusFirstError(form.current);
      return;
    }
    setBusy("email");
    setNotice(null);
    setUnconfirmed(null);
    const { error: failure } = await authClient.signIn.email({
      email: checked.data.email,
      password: checked.data.password,
      rememberMe: data.get("remember") === "on",
    });
    setBusy(null);
    if (!failure) {
      await navigate({ href: redirectTo });
      return;
    }
    if (failure.status === 403 && failure.code === EMAIL_NOT_VERIFIED) {
      setUnconfirmed(checked.data.email);
    } else if (failure.status === 429) {
      setNotice(TOO_MANY_TRIES);
      setLocked(true);
    } else if (failure.status === 401) {
      // Never say which half was wrong
      setErrors({
        password: "That email and password don't match.",
      });
      focusFirstError(form.current);
    } else {
      setNotice({ tone: "danger", title: "We couldn't log you in", message: SOMETHING_WENT_WRONG });
    }
  }

  async function onGoogle() {
    setBusy("google");
    const { error: failure } = await authClient.signIn.social({
      provider: "google",
      callbackURL: redirectTo,
      newUserCallbackURL: "/account",
      errorCallbackURL: "/login",
    });
    if (failure) {
      setBusy(null);
      setNotice(noticeForError("google"));
    }
  }

  return (
    <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
      {notice ? (
        <Alert tone={notice.tone} title={notice.title} announce>
          {notice.message}
        </Alert>
      ) : null}
      {unconfirmed ? (
        <ResendVerificationAlert
          key={unconfirmed}
          email={unconfirmed}
          title="Confirm your email first"
        >
          Open the link we sent you to confirm your email, then log in. Can't find it? We'll send a
          new one.
        </ResendVerificationAlert>
      ) : null}
      <Input
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        iconLeft="mail"
        onChange={update("email")}
        error={errors.email}
        disabled={locked}
      />
      <div className="auth__password">
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          iconLeft="lock"
          onChange={update("password")}
          error={errors.password}
          disabled={locked}
        />
        <Link to="/forgot-password" className="auth__link">
          Forgotten your password?
        </Link>
      </div>
      <Checkbox
        label="Keep me logged in on this device"
        name="remember"
        defaultChecked
        disabled={locked}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy === "email"}
        disabled={!hydrated || locked || busy !== null}
      >
        Log in
      </Button>
      <AuthDivider />
      <GoogleButton onClick={onGoogle} loading={busy === "google"} />
    </form>
  );
}
