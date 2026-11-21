import { Link } from "@tanstack/react-router";

import { Card } from "#/components/display/Card";
import type { PolicyListItem } from "#/server/data/policies";

import { DocumentList } from "./DocumentList";
import { policyDocuments } from "./documents";
import { insured } from "./Overview";

// /account/documents (6.2, decision 2): each policy's documents under what it insures and its
// reference, newest policy first.

export function DocumentsPage({ policies, today }: { policies: PolicyListItem[]; today: string }) {
  return (
    <>
      <h1 className="account__title">Documents</h1>
      {policies.length === 0 ? (
        <Card padding="lg" as="section" aria-label="Documents">
          <div className="ovw__empty ovw__empty--flush">
            <p>You don’t have any documents yet. They’ll appear here when you buy a policy.</p>
            <Link to="/quote" className="kb-btn kb-btn--accent kb-btn--md">
              <span>Get a quote</span>
            </Link>
          </div>
        </Card>
      ) : (
        policies.map((policy) => {
          const { lead, name } = insured(policy);
          const titleId = `docs-${policy.id}`;
          return (
            <Card key={policy.id} padding="md" as="section" aria-labelledby={titleId}>
              <div className="docs__policy">
                <div className="ovw__row-lead">{lead}</div>
                <div>
                  <h2 id={titleId} className="docs__policy-name">
                    <Link
                      to="/account/policies/$reference"
                      params={{ reference: policy.reference }}
                    >
                      {name}
                    </Link>
                  </h2>
                  <p className="docs__meta">{policy.reference}</p>
                </div>
              </div>
              <DocumentList
                reference={policy.reference}
                kinds={policyDocuments(policy, today)}
                boughtOn={policy.boughtOn}
              />
            </Card>
          );
        })
      )}
    </>
  );
}
