import { usePostHog } from "@posthog/react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import { quoteHrefFor, type ProductId } from "#/features/quote/products";

import { ButtonLink } from "./ButtonLink";

interface InsuranceType {
  id: ProductId;
  label: string;
  icon: IconName;
  description: string;
}

// Figma order: left column car, home, condo; right column tenant, landlord, pet. Business isn't in
// Figma; it closes the right column. Every type links to the quote start with its type set, and
// /quote says which ones are coming soon (plan/phases/03-landing/phase.md, Decisions).
const left: InsuranceType[] = [
  {
    id: "car",
    label: "Car insurance",
    icon: "car",
    description:
      "Comprehensive, third party, fire and theft, or third party only. Add breakdown cover, a courtesy car or legal cover, and see your excess before you pay.",
  },
  {
    id: "home",
    label: "Home insurance",
    icon: "house",
    description:
      "Buildings and contents cover for the home you own, with accidental damage as an extra.",
  },
  {
    id: "condo",
    label: "Condo insurance",
    icon: "condo",
    description: "Contents and improvements cover for a flat you own in a shared building.",
  },
];
const right: InsuranceType[] = [
  {
    id: "tenant",
    label: "Tenant insurance",
    icon: "tenant",
    description: "Contents cover for renters, for your belongings wherever you rent.",
  },
  {
    id: "landlord",
    label: "Landlord insurance",
    icon: "land",
    description: "Buildings, liability and loss-of-rent cover for the homes you let.",
  },
  {
    id: "pet",
    label: "Pet insurance",
    icon: "pet",
    description: "Vet fees for accidents and illness, for cats and dogs.",
  },
  {
    id: "business",
    label: "Business insurance",
    icon: "briefcase",
    description: "Public liability, stock and equipment cover for sole traders and small firms.",
  },
];

/**
 * Insurance types (Figma 62:2137 web, 88:2348 tablet, 88:2616 mobile). Native <details>, so each
 * item opens by keyboard and without JS. Car starts open.
 */
export function InsuranceTypes() {
  const posthog = usePostHog();
  const posthogLogger = posthog.logger;

  return (
    <section className="band kinds" aria-labelledby="kinds-title">
      <div className="site-container">
        <div className="landing-heading">
          <p className="landing-heading__overline">What we cover</p>
          <h2 className="landing-heading__title kinds__title" id="kinds-title">
            Insurance for every situation
          </h2>
        </div>
        <div className="kinds__grid">
          {[left, right].map((column, i) => (
            <div key={i} className="kinds__column">
              {column.map((type) => (
                <InsuranceItem
                  key={type.id}
                  type={type}
                  onQuoteSelected={(event, properties) => {
                    posthog.capture(event, properties);
                    posthogLogger.info("insurance quote type selected", properties);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InsuranceItem({
  type,
  onQuoteSelected,
}: {
  type: InsuranceType;
  onQuoteSelected: (event: string, properties: Record<string, string>) => void;
}) {
  return (
    <details className="kinds__item" open={type.id === "car" || undefined}>
      <summary className="kinds__summary">
        <Icon name={type.icon} size={24} />
        <span className="kinds__label">{type.label}</span>
        <Icon name="chevron-down" size={24} className="kinds__chevron" />
      </summary>
      <div className="kinds__body">
        <p>{type.description}</p>
        <ButtonLink
          href={quoteHrefFor(type.id)}
          variant="accent"
          size="sm"
          onClick={() => onQuoteSelected("quote_type_selected", { product_type: type.id })}
        >
          Get a {type.label.toLowerCase()} quote
        </ButtonLink>
      </div>
    </details>
  );
}
