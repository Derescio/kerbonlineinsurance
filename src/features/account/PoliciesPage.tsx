import { Link } from "@tanstack/react-router";

import { Card } from "#/components/display/Card";
import type { PolicyListItem } from "#/server/data/policies";

import { PolicyList } from "./Overview";

// /account/policies (6.2, decision 2): every policy, newest first, as the Overview draws them, with
// no stat cards. Cancelled and ended ones stay, with their badge.

export function PoliciesPage({ policies, today }: { policies: PolicyListItem[]; today: string }) {
  return (
    <>
      <h1 className="account__title">Your policies</h1>
      <Card padding="lg" as="section" aria-label="Your policies">
        {policies.length === 0 ? (
          <div className="ovw__empty ovw__empty--flush">
            <p>You don’t have any policies yet.</p>
            <Link to="/quote" className="kb-btn kb-btn--accent kb-btn--md">
              <span>Get a quote</span>
            </Link>
          </div>
        ) : (
          <PolicyList policies={policies} today={today} />
        )}
      </Card>
    </>
  );
}
