import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";
import {
  accountLink,
  documentsLink,
  makeClaimLink,
  paymentsLink,
  trackClaimLink,
} from "#/components/site/links";

// Paths are shared with the footer (links.ts); the titles are the tiles' own (Figma 54:2034).
export const quickActions: { title: string; subtitle: string; icon: IconName; href: string }[] = [
  {
    title: "Make a claim",
    subtitle: "Around 10 minutes",
    icon: "file-plus",
    href: makeClaimLink.href,
  },
  {
    title: "Track a claim",
    subtitle: "With your claim reference",
    icon: "clock",
    href: trackClaimLink.href,
  },
  {
    title: "Get your documents",
    subtitle: "Certificate and policy schedule",
    icon: "file-text",
    href: documentsLink.href,
  },
  {
    title: "Make a payment",
    subtitle: "Card or bank transfer",
    icon: "credit-card",
    href: paymentsLink.href,
  },
];

/** Quick actions for existing customers (Figma 54:2028 web, 88:2401 tablet, 88:2669 mobile). */
export function QuickActions() {
  return (
    <section className="band quick" aria-labelledby="quick-title">
      <div className="site-container">
        <div className="quick__head">
          <div>
            <h2 className="quick__title" id="quick-title">
              Already with Kerb?
            </h2>
            <p className="quick__sub">You don't need to log in for these.</p>
          </div>
          <a href={accountLink.href} className="quick__account">
            {accountLink.label}
          </a>
        </div>
        <ul className="quick__list">
          {quickActions.map((action) => (
            <li key={action.href}>
              <a href={action.href} className="quick__tile">
                <span className="quick__chip">
                  <Icon name={action.icon} size={20} />
                </span>
                <span className="quick__text">
                  <span className="quick__tile-title">{action.title}</span>
                  <span className="quick__tile-sub">{action.subtitle}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
