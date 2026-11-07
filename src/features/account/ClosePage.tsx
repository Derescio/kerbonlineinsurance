import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Input } from "#/components/forms/Input";
import { focusFirstError, type WriteResult } from "#/lib/validation";
import { useIdempotencyKey, writeOutcome } from "#/lib/writes";
import { CLOSURE_WINDOW_DAYS, PRIVACY_EMAIL, RETENTION } from "#/server/account/constants";
import { PublicError } from "#/server/auth/errors";

import { authClient } from "../auth/auth-client";
import { AuthShell } from "../auth/AuthShell";
import { useHydrated } from "../auth/form";
import { GoogleButton } from "../auth/parts";
import { CodeInput, settle } from "../auth/two-factor/parts";
import { closureSentence, formatDay, useKeepAccount } from "./ClosureBanner";
import { deleteMyAccount, requestMyClosure, type ClosePageData } from "./closure";

// /account/close (4.7, spec "Screens"): delete when nothing is on file, close when there are
// insurance records, the closing status while a closure is open, and the staff message.

export const STAFF_ACCOUNT_MESSAGE =
  "Staff accounts are closed by an admin. Ask an admin to deactivate yours.";

const backToAccount: { text: string; action: ReactNode } = {
  text: "Changed your mind?",
  action: (
    <Link to="/account" className="kb-btn kb-btn--secondary kb-btn--sm">
      <span>Back to account</span>
    </Link>
  ),
};

export function ClosePage({ data }: { data: ClosePageData }) {
  switch (data.kind) {
    case "staff":
      return (
        <AuthShell topBar={backToAccount} title="Close your account">
          <Alert tone="info">{STAFF_ACCOUNT_MESSAGE}</Alert>
        </AuthShell>
      );
    case "delete":
      return <DeleteVersion data={data} />;
    case "close":
      return <CloseVersion data={data} />;
    case "closing":
      return <ClosingVersion data={data} />;
  }
}

type Fields = { password?: string; code?: string };

/**
 * The proof fields (call 12) and the two buttons. `run` makes the write; a thrown sign-in error
 * goes to `onSignedOut`, a success to `onDone`
 */
function ConfirmForm({
  providers,
  twoFactor,
  submitLabel,
  submitVariant,
  run,
  onDone,
  onSignedOut,
  rotate,
}: {
  providers: string[];
  twoFactor: boolean;
  submitLabel: string;
  submitVariant: "danger" | "primary";
  run: (input: Fields) => Promise<WriteResult<unknown>>;
  onDone: () => void;
  onSignedOut: () => void;
  rotate?: () => void;
}) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const hasPassword = providers.includes("credential");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; code?: string }>({});
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function onGoogle() {
    setGoogleBusy(true);
    setMessage(undefined);
    const failure = await settle(() =>
      authClient.signIn.social({ provider: "google", callbackURL: "/account/close" }),
    );
    if (failure) {
      setGoogleBusy(false);
      setMessage("Google sign-in didn't work. Try again in a minute.");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (hasPassword && !password) next.password = "Enter your password.";
    if (twoFactor && !code.trim()) {
      next.code = backup ? "Enter a backup code." : "Enter the 6-digit code from your app.";
    }
    setMessage(undefined);
    setErrors(next);
    if (next.password || next.code) {
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    try {
      const input: Fields = {};
      if (hasPassword) input.password = password;
      if (twoFactor) input.code = code;
      const result = await run(input);
      if (result.ok) {
        onDone();
        return;
      }
      const { fields, message: text } = result.error;
      setErrors({ password: fields.password, code: fields.code });
      if (!fields.password && !fields.code) setMessage(text);
      else focusFirstError(form.current);
    } catch (thrown) {
      const outcome = writeOutcome(thrown);
      if (outcome.kind === "sign_in") {
        onSignedOut();
        return;
      }
      if (outcome.rotateKey) rotate?.();
      setMessage(outcome.message);
    }
    setBusy(false);
  }

  return (
    <form
      ref={form}
      method="post"
      className="auth__form"
      noValidate
      onSubmit={onSubmit}
      aria-label="Confirm it's you"
    >
      {message ? (
        <Alert tone="danger" announce>
          {message}
        </Alert>
      ) : null}
      {hasPassword ? (
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((old) => ({ ...old, password: undefined }));
          }}
          error={errors.password}
        />
      ) : (
        <div className="auth__form">
          <p className="auth__lead">
            You log in with Google, so Google confirms it's you. You'll come straight back here.
          </p>
          <GoogleButton onClick={onGoogle} loading={googleBusy} />
        </div>
      )}
      {twoFactor ? (
        <>
          {backup ? (
            <Input
              label="Backup code"
              name="code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              hint="Each backup code works once."
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setErrors((old) => ({ ...old, code: undefined }));
              }}
              error={errors.code}
            />
          ) : (
            <CodeInput
              value={code}
              onChange={(next) => {
                setCode(next);
                setErrors((old) => ({ ...old, code: undefined }));
              }}
              error={errors.code}
            />
          )}
          <button
            type="button"
            className="auth__link auth__link-button"
            onClick={() => {
              setBackup(!backup);
              setCode("");
              setErrors((old) => ({ ...old, code: undefined }));
            }}
          >
            {backup ? "Use your authenticator app" : "Use a backup code"}
          </button>
        </>
      ) : null}
      <div className="auth__form">
        <Button
          type="submit"
          variant={submitVariant}
          size="lg"
          fullWidth
          loading={busy}
          disabled={!hydrated}
        >
          {submitLabel}
        </Button>
        <Link to="/account" className="kb-btn kb-btn--secondary kb-btn--lg kb-btn--full">
          <span>Keep my account</span>
        </Link>
      </div>
    </form>
  );
}

function DeleteVersion({ data }: { data: Extract<ClosePageData, { kind: "delete" }> }) {
  const navigate = useNavigate();
  // True once a delete call failed without an answer from the app (a network failure or a lost
  // response). Only then can an UNAUTHENTICATED mean "the first try worked"; otherwise the session
  // simply ended. A PublicError is an answer (a 500, RATE_LIMITED and the rest), so it doesn't count.
  const lostResponse = useRef(false);
  const gone = () => void navigate({ to: "/account-deleted" });
  async function run(input: Fields) {
    try {
      return await deleteMyAccount({ data: { input } });
    } catch (thrown) {
      if (!(thrown instanceof PublicError)) lostResponse.current = true;
      throw thrown;
    }
  }
  return (
    <AuthShell
      topBar={backToAccount}
      title="Delete your account"
      subtitle="This deletes your Kerb account and everything in it straight away. It can't be undone."
    >
      <ConfirmForm
        providers={data.providers}
        twoFactor={data.twoFactor}
        submitLabel="Delete my account"
        submitVariant="danger"
        run={run}
        onDone={gone}
        onSignedOut={() =>
          lostResponse.current
            ? gone()
            : void navigate({ to: "/login", search: { redirect: "/account/close" } })
        }
      />
    </AuthShell>
  );
}

function CloseVersion({ data }: { data: Extract<ClosePageData, { kind: "close" }> }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { key, rotate } = useIdempotencyKey("account.close");
  const { records } = data;
  return (
    <AuthShell topBar={backToAccount} title="Close your Kerb account?">
      <div className="auth__form">
        <section aria-labelledby="records-title">
          <h2 id="records-title" className="account__ways-title">
            You have insurance records we must keep
          </h2>
          <ul>
            {records.policies.map((policy) => (
              <li key={policy.id}>
                {policy.product} · {policy.status}
              </li>
            ))}
            {records.claims.map((claim) => (
              <li key={claim.reference}>
                Claim {claim.reference} · {claim.open ? "open" : "closed"}
              </li>
            ))}
          </ul>
          <p className="auth__lead">Closing your account doesn't cancel your cover.</p>
        </section>
        <section aria-labelledby="next-title">
          <h2 id="next-title" className="account__ways-title">
            What happens next
          </h2>
          <ul>
            <li>
              You can still sign in for {CLOSURE_WINDOW_DAYS} days, and keep your account any time
              before {formatDay(data.closesOn)}.
            </li>
            <li>Then your online access ends.</li>
            <li>Your cover stays in force.</li>
            <li>Policy and claim records are kept for {RETENTION.insuranceRecordsYears} years.</li>
            <li>Personal details we don't need are removed.</li>
            <li>
              To manage your policy after that, email{" "}
              <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
            </li>
          </ul>
          {data.openClaim ? (
            <p className="auth__lead">
              Your account will close once claim {data.openClaim} is settled.
            </p>
          ) : null}
        </section>
        <ConfirmForm
          providers={data.providers}
          twoFactor={data.twoFactor}
          submitLabel="Request account closure"
          submitVariant="primary"
          run={(input) => requestMyClosure({ data: { input, idempotencyKey: key } })}
          rotate={rotate}
          onDone={() => {
            rotate();
            void router.invalidate();
          }}
          onSignedOut={() =>
            void navigate({ to: "/login", search: { redirect: "/account/close" } })
          }
        />
      </div>
    </AuthShell>
  );
}

function ClosingVersion({ data }: { data: Extract<ClosePageData, { kind: "closing" }> }) {
  const { keep, busy, kept, error } = useKeepAccount();
  return (
    <AuthShell
      topBar={backToAccount}
      title={kept ? "Your account will stay open" : "Your account is closing"}
      subtitle={kept ? undefined : closureSentence(data)}
    >
      <div className="auth__form">
        {error ? (
          <Alert tone="danger" announce>
            {error}
          </Alert>
        ) : null}
        {kept ? (
          <Alert tone="success" announce>
            We've cancelled the closure. Nothing else has changed.
          </Alert>
        ) : (
          <>
            <p className="auth__lead">
              You can still sign in and keep your account until it closes. Your cover stays in force
              either way.
            </p>
            <Button variant="primary" size="lg" fullWidth loading={busy} onClick={keep}>
              Keep my account
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
