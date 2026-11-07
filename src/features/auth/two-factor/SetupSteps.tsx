import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { renderSVG } from "uqr";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Checkbox } from "#/components/forms/Checkbox";
import { Input } from "#/components/forms/Input";
import { focusFirstError } from "#/lib/validation";

import { authClient, safeRedirect } from "../auth-client";
import { AuthShell } from "../AuthShell";
import { SOMETHING_WENT_WRONG, TOO_FAST, useHydrated } from "../form";
import { TOO_MANY_TRIES } from "../LoginForm";
import { GoogleButton } from "../parts";
import { backupCodesFile, formatSetupKey, isTotp, normaliseTotp, setupKeyFrom } from "./codes";
import {
  CodeInput,
  CopyButton,
  ENTER_CODE,
  notYouTopBar,
  settle,
  verifyOutcome,
  WRONG_CODE,
} from "./parts";
import { StaffGate } from "./StaffGate";

// Turning two-factor on, /account/two-factor (Figma 12, then 11a, 11b, 11c). 6.3's Settings
// reuses the steps. Better Auth's enable() makes the secret and the backup codes; 2FA is only on
// once the first code from the app checks out (verifyTotp), which also stamps this session.

export interface TwoFactorSetup {
  /** "credential" (a password) and/or "google" */
  providers: string[];
  /** Staff see frame 12 first */
  staff: boolean;
}

type Stage = "gate" | "confirm" | "scan" | "codes";

interface Enabled {
  totpURI: string;
  backupCodes: string[];
}

export function SetupSteps({
  setup,
  redirect,
  step,
}: {
  setup: TwoFactorSetup;
  /** Where "Done" goes, checked with safeRedirect */
  redirect?: string;
  /** "scan" when back from confirming with Google */
  step?: "scan";
}) {
  const hasPassword = setup.providers.includes("credential");
  const backFromGoogle = step === "scan" && !hasPassword;
  const [stage, setStage] = useState<Stage>(
    backFromGoogle ? "scan" : setup.staff ? "gate" : "confirm",
  );
  const [enabled, setEnabled] = useState<Enabled | null>(null);

  // Back from Google: enable() without a password. The server allows that only within 10 minutes
  // of the Google sign-in (call 7); later it's SESSION_NOT_FRESH and the Google step shows again.
  // A ref, so a second effect run (StrictMode) can't make a second secret
  const started = useRef(false);
  useEffect(() => {
    if (!backFromGoogle || started.current) return;
    started.current = true;
    void (async () => {
      const result = await settleEnable(() => authClient.twoFactor.enable({}));
      if (result.data) setEnabled(result.data);
      else setStage("confirm");
    })();
  }, [backFromGoogle]);

  if (stage === "gate") return <StaffGate onSetUp={() => setStage("confirm")} />;
  if (stage === "confirm") {
    return hasPassword ? (
      <ConfirmPassword
        onEnabled={(next) => {
          setEnabled(next);
          setStage("scan");
        }}
      />
    ) : (
      <ConfirmWithGoogle redirect={redirect} />
    );
  }
  if (stage === "scan") {
    return enabled ? (
      <Scan totpURI={enabled.totpURI} onVerified={() => setStage("codes")} />
    ) : (
      <AuthShell
        topBar={notYouTopBar}
        title="Set up two-factor"
        subtitle="Step 2 of 3. Getting your code ready…"
      >
        <p className="auth__note">One moment.</p>
      </AuthShell>
    );
  }
  return <BackupCodes codes={enabled?.backupCodes ?? []} redirect={redirect} />;
}

async function settleEnable(call: () => Promise<{ data: unknown; error: unknown }>) {
  try {
    const { data, error } = await call();
    if (error) return { data: null, error: error as { status: number; code?: string } };
    return { data: data as Enabled, error: null };
  } catch {
    return { data: null, error: { status: 0 } as { status: number; code?: string } };
  }
}

/** 11a: the password version, for any account that has one (Review Focus 1) */
function ConfirmPassword({ onEnabled }: { onEnabled: (enabled: Enabled) => void }) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    if (typeof password !== "string" || !password) {
      setError("Enter your password.");
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await settleEnable(() => authClient.twoFactor.enable({ password }));
    setBusy(false);
    if (result.data) return onEnabled(result.data);
    if (result.error.code === "INVALID_PASSWORD") {
      setError("That password isn't right.");
      focusFirstError(form.current);
    } else if (result.error.status === 429) {
      setNotice(TOO_FAST);
    } else {
      setNotice(SOMETHING_WENT_WRONG);
    }
  }

  return (
    <AuthShell
      topBar={notYouTopBar}
      title="Set up two-factor"
      subtitle="Step 1 of 3. Enter your password to continue."
    >
      <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
        {notice ? (
          <Alert tone="danger" title="We couldn't start setting up two-factor" announce>
            {notice}
          </Alert>
        ) : null}
        <Input
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          iconLeft="lock"
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
          Continue
        </Button>
      </form>
    </AuthShell>
  );
}

/** 11a (Google): signing in with Google again makes the session fresh, then back to step 2 */
function ConfirmWithGoogle({ redirect }: { redirect?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const back = safeRedirect(redirect, "");
  async function onGoogle() {
    setBusy(true);
    setFailed(false);
    const failure = await settle(() =>
      authClient.signIn.social({
        provider: "google",
        callbackURL: back
          ? `/account/two-factor?step=scan&redirect=${encodeURIComponent(back)}`
          : "/account/two-factor?step=scan",
      }),
    );
    if (failure) {
      setBusy(false);
      setFailed(true);
    }
  }
  return (
    <AuthShell
      topBar={notYouTopBar}
      title="Set up two-factor"
      subtitle="Step 1 of 3. Confirm it's you with Google to continue."
    >
      <div className="auth__form">
        {failed ? (
          <Alert tone="danger" title="Google sign-in didn't work" announce>
            Try again in a minute.
          </Alert>
        ) : null}
        <p className="auth__lead">
          You signed in with Google, so Google confirms it's you. You'll come straight back here.
        </p>
        <GoogleButton onClick={onGoogle} loading={busy} />
      </div>
    </AuthShell>
  );
}

/** 11b: the QR code (or, on a phone, the otpauth:// link first), the key, and the first code */
function Scan({ totpURI, onVerified }: { totpURI: string; onVerified: () => void }) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{
    tone: "warning" | "danger";
    title: string;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // Read after hydration, so the server and first client render agree
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  const qr = useMemo(
    () => renderSVG(totpURI, { whiteColor: "#ffffff", blackColor: "#0b2a22", border: 2 }),
    [totpURI],
  );
  const key = setupKeyFrom(totpURI);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalised = normaliseTotp(code);
    if (!isTotp(normalised)) {
      setError(ENTER_CODE);
      focusFirstError(form.current);
      return;
    }
    setBusy(true);
    setNotice(null);
    const failure = await settle(() => authClient.twoFactor.verifyTotp({ code: normalised }));
    setBusy(false);
    if (!failure) return onVerified();
    const outcome = verifyOutcome(failure);
    if (outcome === "wrong") {
      setError(WRONG_CODE);
      focusFirstError(form.current);
    } else if (outcome === "locked") {
      setNotice(TOO_MANY_TRIES);
    } else {
      setNotice({
        tone: "danger",
        title: "We couldn't check your code",
        message: SOMETHING_WENT_WRONG,
      });
    }
  }

  return (
    <AuthShell
      topBar={notYouTopBar}
      title="Set up two-factor"
      subtitle="Step 2 of 3. Scan this with an authenticator app, like Google Authenticator or 1Password."
    >
      <form ref={form} method="post" className="auth__form" noValidate onSubmit={onSubmit}>
        {notice ? (
          <Alert tone={notice.tone} title={notice.title} announce>
            {notice.message}
          </Alert>
        ) : null}
        {coarse ? (
          <>
            <a href={totpURI} className="kb-btn kb-btn--secondary kb-btn--lg kb-btn--full">
              <span>Open in authenticator app</span>
            </a>
            <p className="auth__note auth__note--body">Or scan this code from another device:</p>
          </>
        ) : null}
        <div
          className="auth-qr"
          role="img"
          aria-label="QR code for your authenticator app"
          // uqr's SVG, made here from the otpauth URI; no user text goes in unescaped
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <div className="auth-setup-key">
          <p className="auth__note auth__note--body">Can't scan it? Enter this key instead:</p>
          <div className="auth-setup-key__row">
            <code className="auth-setup-key__key">{formatSetupKey(key)}</code>
            <CopyButton text={key} />
          </div>
        </div>
        <CodeInput
          label="Then enter the 6-digit code it shows"
          value={code}
          onChange={(next) => {
            setCode(next);
            setError(undefined);
          }}
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
          Turn on two-factor
        </Button>
      </form>
    </AuthShell>
  );
}

/** 11c: the ten codes, shown once. "Done" waits for the tick */
function BackupCodes({ codes, redirect }: { codes: string[]; redirect?: string }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const half = Math.ceil(codes.length / 2);

  function download() {
    const url = URL.createObjectURL(new Blob([backupCodesFile(codes)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "kerb-backup-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <AuthShell
      topBar={notYouTopBar}
      title="Save your backup codes"
      subtitle="Step 3 of 3. If you lose your phone, each code gets you in once. We won't show them again."
    >
      <div className="auth__form">
        <div className="auth-backup">
          <div className="auth-backup__codes">
            <ul>
              {codes.slice(0, half).map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <ul>
              {codes.slice(half).map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
          <div className="auth-backup__actions">
            <Button variant="secondary" size="sm" iconLeft="download" onClick={download}>
              Download
            </Button>
            <CopyButton text={codes.join("\n")} />
          </div>
        </div>
        <Checkbox
          label="I've saved these somewhere safe"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!saved}
          onClick={() => void navigate({ href: safeRedirect(redirect) })}
        >
          Done
        </Button>
      </div>
    </AuthShell>
  );
}
