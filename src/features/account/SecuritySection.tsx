import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "#/components/actions/Button";
import { Badge } from "#/components/display/Badge";
import { Alert } from "#/components/feedback/Alert";
import { Dialog } from "#/components/feedback/Dialog";
import { useToast } from "#/components/feedback/Toaster";
import { Input } from "#/components/forms/Input";
import type { RecentActivity as Activity } from "#/server/data/settings";

import { authClient } from "../auth/auth-client";
import { SOMETHING_WENT_WRONG } from "../auth/form";
import { GoogleButton, GoogleMark } from "../auth/parts";
import { signOutEverywhereFn, type AccountSummary } from "../auth/session";
import { RecentActivity } from "./RecentActivity";
import { SettingsTitle } from "./SettingsLayout";

// Security (6.3, decisions 5 and 6; Figma 06 276:3822, dialogs 07 276:3885 and 08 276:3900).
// Turning two-factor off is Better Auth's /two-factor/disable, whose 4.6 hooks write the event and
// the audit row; "Sign out everywhere" is 4.6's server function.

const HERE = "/account/settings/security";

export function SecuritySection({
  summary,
  staff,
  activity,
  now = new Date(),
}: {
  summary: AccountSummary;
  staff: boolean;
  activity: Activity[];
  now?: Date;
}) {
  return (
    <>
      <SettingsTitle>Security</SettingsTitle>
      <div className="settings__rows">
        <WaysToLogIn providers={summary.providers} />
        <TwoFactor
          enabled={summary.twoFactorEnabled}
          staff={staff}
          hasPassword={summary.providers.includes("credential")}
        />
        <SignOutEverywhere />
        <RecentActivity activity={activity} now={now} />
        <CloseAccount />
      </div>
    </>
  );
}

function SecurityRow({
  title,
  badge,
  text,
  action,
}: {
  title: string;
  badge?: ReactNode;
  text: string;
  action?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings__security-row" role="group" aria-labelledby={id}>
      <div className="settings__security-text">
        <p className="settings__security-title">
          <span id={id}>{title}</span>
          {badge}
        </p>
        <p className="settings__security-detail">{text}</p>
      </div>
      {action}
    </div>
  );
}

function WaysToLogIn({ providers }: { providers: string[] }) {
  const hasPassword = providers.includes("credential");
  const hasGoogle = providers.includes("google");
  const [busy, setBusy] = useState(false);

  async function connectGoogle() {
    setBusy(true);
    const { error } = await authClient.linkSocial({
      provider: "google",
      callbackURL: `${HERE}?linked=google`,
      errorCallbackURL: `${HERE}?error=link`,
    });
    if (error) setBusy(false);
  }

  const text =
    hasPassword && hasGoogle
      ? "Email and password, or Google."
      : hasGoogle
        ? "Google. To add a password, use “Forgotten your password?” on the log-in page."
        : "Email and password. Connect Google to log in with one tap.";

  return (
    <SecurityRow
      title="Ways to log in"
      text={text}
      action={
        hasPassword && !hasGoogle ? (
          <Button variant="secondary" onClick={connectGoogle} loading={busy}>
            {busy ? null : <GoogleMark size={18} />}
            Connect Google
          </Button>
        ) : undefined
      }
    />
  );
}

/** On/Off with an optimistic Turn off (decision 6): Off shows at once and goes back on a refusal */
function TwoFactor({
  enabled: initial,
  staff,
  hasPassword,
}: {
  enabled: boolean;
  staff: boolean;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = useState(initial);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  function openDialog() {
    setPassword("");
    setError(undefined);
    setNeedsGoogle(false);
    setOpen(true);
  }

  async function turnOff(event: FormEvent) {
    event.preventDefault();
    if (hasPassword && password === "") {
      setError("Enter your password");
      return;
    }
    setEnabled(false);
    setOpen(false);
    let failure: { status?: number; code?: string } | null;
    try {
      const result = await authClient.twoFactor.disable(hasPassword ? { password } : {});
      failure = result.error;
    } catch {
      failure = { status: 0 };
    }
    if (!failure) {
      void router.invalidate();
      return;
    }
    setEnabled(true);
    if (failure.code === "INVALID_PASSWORD") {
      setError("That password isn't right.");
      setOpen(true);
    } else if (failure.code === "SESSION_NOT_FRESH") {
      setNeedsGoogle(true);
      setOpen(true);
    } else {
      toast({ tone: "danger", title: "Two-factor is still on", message: SOMETHING_WENT_WRONG });
    }
  }

  async function confirmWithGoogle() {
    setGoogleBusy(true);
    try {
      const { error: failed } = await authClient.signIn.social({
        provider: "google",
        callbackURL: HERE,
      });
      if (failed) setGoogleBusy(false);
    } catch {
      setGoogleBusy(false);
    }
  }

  const formId = useId();
  return (
    <>
      <SecurityRow
        title="Two-factor"
        badge={
          <Badge tone={enabled ? "success" : "neutral"} dot>
            {enabled ? "On" : "Off"}
          </Badge>
        }
        text={
          staff && enabled
            ? "Staff accounts keep two-factor on."
            : enabled
              ? "You'll enter a code from your authenticator app when you log in."
              : "Add a code from an authenticator app when you log in."
        }
        action={
          !enabled ? (
            <Link
              to="/account/two-factor"
              search={{ redirect: HERE }}
              className="kb-btn kb-btn--secondary kb-btn--md"
            >
              <span>Turn on</span>
            </Link>
          ) : staff ? undefined : (
            <Button variant="secondary" onClick={openDialog}>
              Turn off
            </Button>
          )
        }
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Turn off two-factor?"
        actions={
          needsGoogle ? (
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" type="submit" form={formId}>
                Turn off two-factor
              </Button>
            </>
          )
        }
      >
        {needsGoogle ? (
          <div className="settings__dialog-body">
            <p className="settings__dialog-text">For your security, confirm with Google first.</p>
            <GoogleButton
              label="Confirm with Google"
              onClick={confirmWithGoogle}
              loading={googleBusy}
            />
          </div>
        ) : (
          <form id={formId} className="settings__dialog-body" onSubmit={turnOff} noValidate>
            <Alert tone="warning">
              Anyone with your password will be able to log in without a code.
            </Alert>
            {hasPassword ? (
              <Input
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                error={error}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(undefined);
                }}
              />
            ) : null}
          </form>
        )}
      </Dialog>
    </>
  );
}

function SignOutEverywhere() {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await signOutEverywhereFn();
      // Every session is gone, this one included
      await navigate({ href: "/login?signedOut=everywhere", replace: true });
    } catch {
      setBusy(false);
      setOpen(false);
      toast({ tone: "danger", title: "Still signed in", message: SOMETHING_WENT_WRONG });
    }
  }

  return (
    <>
      <SecurityRow
        title="Sign out everywhere"
        text="Signs you out on every device, including this one."
        action={
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Sign out everywhere
          </Button>
        }
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Sign out everywhere?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={signOut} loading={busy}>
              Sign out everywhere
            </Button>
          </>
        }
      >
        <p className="settings__dialog-text">
          You'll be signed out on every device, including this one. You'll need to log in again.
        </p>
      </Dialog>
    </>
  );
}

/** Close your account (4.7): the choice between deleting and closing is made on the next page */
function CloseAccount() {
  return (
    <SecurityRow
      title="Close your account"
      text="Delete your account, or close it if you have insurance records we must keep."
      action={
        <Link to="/account/close" className="kb-btn kb-btn--secondary kb-btn--md">
          <span>Close your account</span>
        </Link>
      }
    />
  );
}
