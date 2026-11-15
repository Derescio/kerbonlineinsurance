import { useRef, useState, type FormEvent } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { describedBy } from "#/components/forms/Field";
import { Input } from "#/components/forms/Input";
import { fieldErrors, focusFirstError, type FieldErrors } from "#/lib/validation";

import { authClient, captchaHeaders } from "./auth-client";
import { formText, ROBOT_CHECK_FAILED, SOMETHING_WENT_WRONG, TOO_FAST, useHydrated } from "./form";
import { AuthDivider, GoogleButton, PasswordHint } from "./parts";
import { LINK_HOURS, ResendVerificationAlert } from "./ResendVerification";
import { signUpSchema, type SignUpInput } from "./schemas";
import { Turnstile } from "./Turnstile";
import type { Journey } from "#/features/quote/journey-store";

// Create account (Figma 03, 03b) and "Check your inbox" (03c, 4.4b).

export const BREACHED_PASSWORD_MESSAGE = "This password was in a data breach. Try a different one.";
const ROBOT_CHECK_PENDING = "Wait for the check above to finish, then try again.";

type Errors = FieldErrors<SignUpInput> & { robot?: string };

/** What screen 15 adds to the "Check your inbox" panel when the sign-up carried a quote (5.6) */
export const QUOTE_SAVED_LINE =
  "Your quote is saved to your new account. Confirm your email, sign in, and you’ll find it under Your saved quotes.";

export function SignUpForm({
  title,
  extraLine,
  quote,
  redirectTo = "/account",
}: {
  /** A heading on the form, as the quote gate's card has (5.6, decision 3) */
  title?: string;
  /** A line under the terms box */
  extraLine?: string;
  /** Sent with the sign-up: a new account gets this quote saved against it (5.6, decision 1) */
  quote?: { journey: Omit<Journey, "lastPlate" | "saved"> };
  /** Where Google sign-in returns to */
  redirectTo?: string;
} = {}) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  // Set once the account is made: you confirm your email before you can log in (4.4b)
  const [sentTo, setSentTo] = useState<string | null>(null);

  const update = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read from the form, not state: anything typed before hydration is still there
    const data = new FormData(event.currentTarget);
    const checked = fieldErrors(signUpSchema, {
      name: formText(data, "name"),
      email: formText(data, "email"),
      password: formText(data, "password"),
      acceptTerms: data.get("acceptTerms") === "on",
    });
    const robot = token ? undefined : ROBOT_CHECK_PENDING;
    if (checked.errors || robot) {
      setErrors({ ...checked.errors, robot });
      focusFirstError(form.current);
      return;
    }
    setBusy("email");
    setNotice(null);
    const { error } = await authClient.signUp.email(
      {
        name: checked.data.name,
        email: checked.data.email,
        password: checked.data.password,
        callbackURL: "/email-confirmed",
        // Checked again on the server, which records when (decision 5)
        acceptTerms: true,
        ...(quote && { quote }),
      } as Parameters<typeof authClient.signUp.email>[0],
      { headers: captchaHeaders(token!) },
    );
    setBusy(null);
    // A taken email gets this same answer, so sign-up never shows who has an account (4.4b)
    if (!error) {
      setSentTo(checked.data.email);
      return;
    }
    // A token works once, so any failure needs a fresh check
    setResetKey((key) => key + 1);
    if (error.code === "PASSWORD_COMPROMISED") {
      setErrors({ password: BREACHED_PASSWORD_MESSAGE });
      focusFirstError(form.current);
    } else if (error.status === 429) {
      setNotice(TOO_FAST);
    } else if (error.status === 403) {
      setNotice(ROBOT_CHECK_FAILED);
    } else {
      setNotice(SOMETHING_WENT_WRONG);
    }
  }

  async function onGoogle() {
    setBusy("google");
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: redirectTo,
      errorCallbackURL: "/login",
    });
    if (error) {
      setBusy(null);
      setNotice("Google sign-in didn't work. Try again, or use your email.");
    }
  }

  if (sentTo) {
    return (
      <div className="auth__form">
        <ResendVerificationAlert email={sentTo} title="Check your inbox">
          {`We sent a link to ${sentTo}. Open it to confirm your email, then you're in. It works for ${LINK_HOURS} hours.`}
        </ResendVerificationAlert>
        {quote ? <p className="auth__note">{QUOTE_SAVED_LINE}</p> : null}
        <Button
          variant="ghost"
          size="lg"
          fullWidth
          onClick={() => {
            setSentTo(null);
            setResetKey((key) => key + 1);
          }}
        >
          Wrong email? Start again
        </Button>
      </div>
    );
  }

  return (
    <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
      {title ? <h2 className="kb-h3">{title}</h2> : null}
      <GoogleButton onClick={onGoogle} loading={busy === "google"} />
      <AuthDivider>or use your email</AuthDivider>
      {notice ? (
        <Alert tone="danger" title="We couldn't create your account" announce>
          {notice}
        </Alert>
      ) : null}
      <Input
        label="Full name"
        name="name"
        autoComplete="name"
        iconLeft="user"
        placeholder="As it appears on your driving licence"
        onChange={update("name")}
        error={errors.name}
      />
      <Input
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        iconLeft="mail"
        onChange={update("email")}
        error={errors.email}
      />
      <div className="auth__password">
        <Input
          id="signup-password"
          label="Create a password"
          type="password"
          name="password"
          autoComplete="new-password"
          iconLeft="lock"
          onChange={update("password")}
          error={errors.password}
          // The Input's own error id plus the hint, so both are read out
          aria-describedby={[
            describedBy("signup-password", { error: errors.password }),
            "signup-password-hint",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <PasswordHint id="signup-password-hint" password={values.password} />
      </div>
      <Checkbox
        label="I agree to the terms of use"
        description="We only use your details to run your account."
        name="acceptTerms"
        onChange={() => setErrors((current) => ({ ...current, acceptTerms: undefined }))}
        aria-invalid={errors.acceptTerms ? true : undefined}
        aria-describedby={errors.acceptTerms ? "signup-terms-error" : undefined}
      />
      {errors.acceptTerms ? (
        <p id="signup-terms-error" className="kb-field__error auth__inline-error">
          {errors.acceptTerms}
        </p>
      ) : null}
      {extraLine ? <p className="auth__note">{extraLine}</p> : null}
      <div>
        <Turnstile
          resetKey={resetKey}
          onToken={(next) => {
            setToken(next);
            if (next) setErrors((current) => ({ ...current, robot: undefined }));
          }}
        />
        {errors.robot ? (
          <p className="kb-field__error auth__inline-error" role="alert">
            {errors.robot}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy === "email"}
        disabled={!hydrated || busy !== null}
      >
        Create account
      </Button>
      <p className="auth__note">
        Already have a Kerb policy? Use the email on your policy and we'll link it to your account.
      </p>
    </form>
  );
}
