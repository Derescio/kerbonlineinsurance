import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Icon } from "#/components/display/Icon";
import type { IconName } from "#/components/display/icons";

// Account settings' page (6.3, decision 2; Figma Account · Settings 182:3249): the section nav on
// the left and the section's card. Payment methods is the existing Stripe portal (5.6b). Below
// 768px the nav is a row of links above the card.

export type SettingsSection = "personal" | "security";

const sections: {
  section: SettingsSection | "payment";
  to: "/account/settings" | "/account/settings/security" | "/account/billing";
  label: string;
  icon: IconName;
}[] = [
  { section: "personal", to: "/account/settings", label: "Personal details", icon: "user" },
  { section: "security", to: "/account/settings/security", label: "Security", icon: "shield" },
  { section: "payment", to: "/account/billing", label: "Payment methods", icon: "credit-card" },
];

export function SettingsLayout({
  section,
  children,
}: {
  section: SettingsSection;
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="account__title">Account settings</h1>
      <div className="settings">
        <nav className="settings__nav" aria-label="Settings">
          <ul>
            {sections.map((item) => (
              <li key={item.section}>
                <Link
                  to={item.to}
                  // A full page load, never a preload: /account/billing makes a Stripe portal
                  // session each time
                  reloadDocument={item.section === "payment"}
                  aria-current={item.section === section ? "page" : undefined}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="settings__card" aria-labelledby="settings-section-title">
          {children}
        </section>
      </div>
    </>
  );
}

/** The card's title, which also names the section */
export function SettingsTitle({ children }: { children: ReactNode }) {
  return (
    <h2 id="settings-section-title" className="settings__title">
      {children}
    </h2>
  );
}
