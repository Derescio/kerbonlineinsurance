import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "#/components/actions/Button";
import { Wordmark } from "#/components/display/Wordmark";
import { Alert } from "#/components/feedback/Alert";

import { authClient } from "./auth-client";
import { TOO_FAST } from "./form";
import { DemoStrip, GoogleMark } from "./parts";
import type { AccountSummary } from "./session";
import { useOneTimeToast } from "./use-one-time-toast";

// The minimal account page (4.4, decision 6; Figma 07, 07b, 07c and the Connect Google panel).
// 6.1 replaces the body with the real dashboard; the banner and "Ways to log in" move with it.

const RESEND_WAIT_SECONDS = 60;

export interface AccountNotice {
  confirmed?: boolean;
  linked?: "google";
  error?: string;
}

export function AccountPage({
  summary,
  notice,
}: {
  summary: AccountSummary;
  notice: AccountNotice;
}) {
  const navigate = useNavigate();
  const { user, providers, greeting } = summary;
  const [signingOut, setSigningOut] = useState(false);

  useOneTimeToast(
    notice.confirmed
      ? { tone: "success", title: "Email confirmed", message: "Thanks. Your account is all set." }
      : notice.linked === "google"
        ? { tone: "success", title: "Google connected", message: "You can now log in with Google." }
        : notice.error
          ? {
              tone: "danger",
              title: "Google wasn't connected",
              message:
                "Use the Google account with the same email as your Kerb account, then try again.",
            }
          : null,
    () => void navigate({ to: "/account", search: {}, replace: true }),
  );

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    await navigate({ to: "/" });
  }

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <div className="account">
      <a href="#main" className="site-skip">
        Skip to content
      </a>
      <DemoStrip />
      <header className="account__header">
        <div className="site-container account__header-inner">
          <a href="/" aria-label="Kerb home">
            <Wordmark tone="inverse" size={26} />
          </a>
          <Button
            variant="secondary"
            size="sm"
            iconLeft="log-out"
            loading={signingOut}
            onClick={signOut}
          >
            Log out
          </Button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="site-container account__body">
        {user.emailVerified ? null : <VerifyBanner email={user.email} />}
        <h1 className="account__title">
          {greeting}, {firstName}
        </h1>
        <WaysToLogIn providers={providers} />
        <section className="account__placeholder" aria-label="Your account">
          <p>Your policies, documents and claims will appear here.</p>
        </section>
      </main>
    </div>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [wait, setWait] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function resend() {
    setState("sending");
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/email-confirmed",
    });
    if (error) {
      setState("failed");
      setFailure(error.status === 429 ? TOO_FAST : "We couldn't send it. Try again in a minute.");
      return;
    }
    setState("sent");
    setWait(RESEND_WAIT_SECONDS);
  }

  const message =
    state === "sent"
      ? "Sent. It can take a minute to arrive. Check your spam folder too."
      : state === "failed" && failure
        ? failure
        : `We sent a link to ${email}. Open it to confirm your address.`;

  return (
    <Alert
      tone="info"
      title="Confirm your email"
      announce={state !== "idle"}
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

function WaysToLogIn({ providers }: { providers: string[] }) {
  const hasPassword = providers.includes("credential");
  const hasGoogle = providers.includes("google");
  const [busy, setBusy] = useState(false);

  async function connectGoogle() {
    setBusy(true);
    const { error } = await authClient.linkSocial({
      provider: "google",
      callbackURL: "/account?linked=google",
      errorCallbackURL: "/account?error=link",
    });
    if (error) setBusy(false);
  }

  const description =
    hasPassword && hasGoogle
      ? "Email and password, or Google."
      : hasGoogle
        ? "Google. To add a password, use “Forgotten your password?” on the log-in page."
        : "Email and password. Connect Google to log in with one tap.";

  return (
    <section className="account__ways" aria-labelledby="ways-title">
      <div>
        <h2 id="ways-title" className="account__ways-title">
          Ways to log in
        </h2>
        <p className="account__ways-text">{description}</p>
      </div>
      {hasPassword && !hasGoogle ? (
        <Button variant="secondary" size="md" onClick={connectGoogle} loading={busy}>
          {busy ? null : <GoogleMark size={18} />}
          Connect Google
        </Button>
      ) : null}
    </section>
  );
}
