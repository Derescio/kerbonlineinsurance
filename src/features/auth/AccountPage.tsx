import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Wordmark } from "#/components/display/Wordmark";

import { ClosureBanner } from "../account/ClosureBanner";
import { authClient } from "./auth-client";
import { DemoStrip, GoogleMark } from "./parts";
import type { AccountSummary } from "./session";
import { useOneTimeToast } from "./use-one-time-toast";

// The minimal account page (4.4, decision 6; Figma 07c and the Connect Google panel). 6.1 replaces
// the body with the real dashboard; "Ways to log in" moves with it. The verify banner (07, 07b) went
// in 4.4b: you confirm your email before you can log in, so everyone here is confirmed.

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
      <ClosureBanner />
      <main id="main" tabIndex={-1} className="site-container account__body">
        <h1 className="account__title">
          {greeting}, {firstName}
        </h1>
        <WaysToLogIn providers={providers} />
        <TwoFactor enabled={summary.twoFactorEnabled} />
        <CloseAccount />
        <section className="account__placeholder" aria-label="Your account">
          <p>Your policies, documents and claims will appear here.</p>
        </section>
      </main>
    </div>
  );
}

/** Two-factor (4.6): a link to /account/two-factor until 6.3's Settings reuses the steps */
function TwoFactor({ enabled }: { enabled: boolean }) {
  return (
    <section className="account__ways" aria-labelledby="two-factor-title">
      <div>
        <h2 id="two-factor-title" className="account__ways-title">
          Two-factor
        </h2>
        <p className="account__ways-text">
          {enabled
            ? "On. You'll enter a code from your authenticator app when you log in."
            : "Off. Add a code from an authenticator app when you log in."}
        </p>
      </div>
      {enabled ? null : (
        <Link to="/account/two-factor" className="kb-btn kb-btn--secondary kb-btn--md">
          <span>Set up two-factor</span>
        </Link>
      )}
    </section>
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

/** Close your account (4.7): the choice between deleting and closing is made on the next page */
function CloseAccount() {
  return (
    <section className="account__ways" aria-labelledby="close-title">
      <div>
        <h2 id="close-title" className="account__ways-title">
          Close your account
        </h2>
        <p className="account__ways-text">
          Delete your account, or close it if you have insurance records we must keep.
        </p>
      </div>
      <Link to="/account/close" className="kb-btn kb-btn--secondary kb-btn--md">
        <span>Close your account</span>
      </Link>
    </section>
  );
}
