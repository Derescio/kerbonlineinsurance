import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/actions/Button";

import { authClient } from "../auth/auth-client";
import { GoogleMark } from "../auth/parts";
import type { AccountSummary } from "../auth/session";

// Account settings (6.1, decision 2): ways to log in, two-factor and closing the account, moved as
// they were from /account, behind the avatar menu. 6.3 rebuilds this page to the Account settings
// frames (Figma 182:3249).

export function AccountSettings({ summary }: { summary: AccountSummary }) {
  return (
    <>
      <h1 className="account__title">Account settings</h1>
      <WaysToLogIn providers={summary.providers} />
      <TwoFactor enabled={summary.twoFactorEnabled} />
      <CloseAccount />
    </>
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
      callbackURL: "/account/settings?linked=google",
      errorCallbackURL: "/account/settings?error=link",
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
