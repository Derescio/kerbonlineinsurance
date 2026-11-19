import { Link, useNavigate } from "@tanstack/react-router";

import { Badge } from "#/components/display/Badge";
import { Icon } from "#/components/display/Icon";
import { tierName } from "#/features/quote/labels";
import { formatPounds } from "#/features/rating/money";
import type { PolicyListItem } from "#/server/data/policies";

import { AccountShell } from "../account/AccountShell";
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
  const { user, greeting } = summary;

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

  const firstName = user.name.trim().split(/s+/)[0] ?? user.name;

  return (
    <AccountShell name={user.name} current="overview">
      <h1 className="account__title">
        {greeting}, {firstName}
      </h1>
      <YourPolicies policies={policies} />
    </AccountShell>
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
