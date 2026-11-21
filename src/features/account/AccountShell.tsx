import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Wordmark } from "#/components/display/Wordmark";
import { useToast } from "#/components/feedback/Toaster";
import { MenuButton, type MenuItem } from "#/components/navigation/MenuButton";

import { logOutHome } from "../auth/log-out";
import { DemoStrip } from "../auth/parts";
import { ClosureBanner } from "./ClosureBanner";

// The account header (6.1, decision 1; Figma Acct / Header 181:3310, Overview 258:3608): every
// account page sits in it. Tabs appear with their pages (Claims in 6.4) and the bell with
// notifications (6.6), so nothing here leads to a page that isn't built.

export type AccountTab = "overview" | "policies" | "documents";

const tabs: {
  tab: AccountTab;
  to: "/account" | "/account/policies" | "/account/documents";
  label: string;
}[] = [
  { tab: "overview", to: "/account", label: "Overview" },
  { tab: "policies", to: "/account/policies", label: "Policies" },
  { tab: "documents", to: "/account/documents", label: "Documents" },
];

/** "MP" for "Maya Patel": the first and last words' first letters; "?" with no name */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words.at(-1)!.charAt(0) : "";
  return (first + last).toUpperCase();
}

export function AccountShell({
  name,
  current,
  children,
}: {
  name: string;
  /** The tab to mark as the current page; none on pages without a tab (settings) */
  current?: AccountTab;
  children: ReactNode;
}) {
  const toast = useToast();
  const menu: MenuItem[] = [
    { label: "Account settings", href: "/account/settings" },
    {
      label: "Log out",
      onSelect: async () => {
        const failed = await logOutHome();
        if (failed) toast({ tone: "danger", title: "Still signed in", message: failed });
      },
    },
  ];

  return (
    <div className="account">
      <a href="#main" className="site-skip">
        Skip to content
      </a>
      <DemoStrip />
      <header className="acct-header">
        <div className="site-container acct-header__bar">
          <a href="/" className="acct-header__home" aria-label="Kerb home">
            <Wordmark tone="inverse" size={26} />
          </a>
          <nav className="acct-header__nav" aria-label="Account">
            <ul>
              {tabs.map(({ tab, to, label }) => (
                <li key={tab}>
                  <Link
                    to={to}
                    activeOptions={{ exact: true }}
                    aria-current={current === tab ? "page" : undefined}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <MenuButton
            accessibleName={`${initialsOf(name)}, account menu`}
            items={menu}
            buttonClassName="acct-header__avatar"
            className="acct-header__menu"
          >
            {initialsOf(name)}
          </MenuButton>
        </div>
      </header>
      <ClosureBanner />
      <main id="main" tabIndex={-1} className="site-container account__body">
        {children}
      </main>
    </div>
  );
}
