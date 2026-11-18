import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Badge } from "#/components/display/Badge";
import { Icon } from "#/components/display/Icon";
import { Wordmark } from "#/components/display/Wordmark";
import { tierName } from "#/features/quote/labels";
import { formatPounds } from "#/features/rating/money";
import type { PolicyListItem } from "#/server/data/policies";

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
  policies,
  notice,
}: {
  summary: AccountSummary;
  policies: PolicyListItem[];
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
        <YourPolicies policies={policies} />
        <WaysToLogIn providers={providers} />
        <TwoFactor enabled={summary.twoFactorEnabled} />
        <CloseAccount />
      </main>
    </div>
  );
}

const POLICY_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const policyDay = (iso: string) => POLICY_DATE.format(new Date(`${iso}T00:00:00Z`));
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Your policies (5.6, decision 12), from listMyPolicies until 6.1's dashboard replaces it. A monthly
 * policy links to /account/billing to update the card, and a lapsed one says so (5.6b, decision 9).
 * A car + home bundle's policies sit together under "Car + home bundle", with the saving (5.7b)
 */
function YourPolicies({ policies }: { policies: PolicyListItem[] }) {
  return (
    <section className="account__policies" aria-labelledby="policies-title">
      <div className="account__policies-head">
        <h2 id="policies-title" className="account__ways-title">
          Your policies
        </h2>
        <Link to="/quote/retrieve" className="kb-btn kb-btn--secondary kb-btn--md">
          <span>Your saved quotes</span>
        </Link>
      </div>
      {policies.length === 0 ? (
        <p className="account__ways-text">You don’t have any policies yet.</p>
      ) : (
        <ul className="account__policy-list">
          {groupByBundle(policies).map((group) =>
            group.bundle ? (
              <li key={group.bundle.id}>
                <div
                  role="group"
                  aria-labelledby={`bundle-${group.bundle.id}`}
                  className="account__bundle"
                >
                  <div className="account__bundle-head">
                    <span className="account__bundle-icons" aria-hidden="true">
                      <Icon name="car" size={18} />
                      <Icon name="house" size={18} />
                    </span>
                    <p id={`bundle-${group.bundle.id}`} className="account__bundle-title">
                      Car + home bundle
                    </p>
                    {group.bundle.savingPence ? (
                      <p className="account__ways-text">
                        You save {formatPounds(group.bundle.savingPence)} a year
                      </p>
                    ) : null}
                  </div>
                  <ul className="account__policy-list">
                    {group.policies.map((policy) => (
                      <PolicyRow key={policy.id} policy={policy} />
                    ))}
                  </ul>
                </div>
              </li>
            ) : (
              <PolicyRow key={group.policies[0]!.id} policy={group.policies[0]!} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** Bundled policies together where the first of them falls in the list, car first (5.7b) */
function groupByBundle(policies: PolicyListItem[]) {
  const groups: { bundle: PolicyListItem["bundle"]; policies: PolicyListItem[] }[] = [];
  const byBundle = new Map<string, PolicyListItem[]>();
  for (const policy of policies) {
    if (!policy.bundle) {
      groups.push({ bundle: null, policies: [policy] });
      continue;
    }
    const members = byBundle.get(policy.bundle.id);
    if (members) {
      members.push(policy);
      continue;
    }
    const group = { bundle: policy.bundle, policies: [policy] };
    byBundle.set(policy.bundle.id, group.policies);
    groups.push(group);
  }
  for (const group of groups) {
    group.policies.sort((a, b) => (a.product === b.product ? 0 : a.product === "car" ? -1 : 1));
  }
  return groups;
}

/** One policy: its reference, product and level, status, dates and the card link */
function PolicyRow({ policy }: { policy: PolicyListItem }) {
  return (
    <li className="account__policy">
      <div className="account__policy-head">
        <p className="account__policy-ref">{policy.reference}</p>
        {policy.bundle ? <Badge tone="success">Bundle</Badge> : null}
      </div>
      <p className="account__ways-text">
        {capitalise(policy.product)} · {tierName(policy.coverLevel)}
      </p>
      {policy.status === "lapsed" ? (
        <p>
          <Badge tone="warning">Lapsed</Badge>
        </p>
      ) : (
        <p className="account__ways-text">{capitalise(policy.status)}</p>
      )}
      <p className="account__ways-text">
        {policyDay(policy.startsOn)} to {policyDay(policy.endsOn)}
      </p>
      {policy.monthly ? (
        // A full page load, never a preload: /account/billing makes a Stripe portal
        // session each time it loads (5.6b, decision 9)
        <Link to="/account/billing" reloadDocument className="auth__link">
          Update your payment card
        </Link>
      ) : null}
    </li>
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
