import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Wordmark } from "#/components/display/Wordmark";

import { BrandPanel, DemoStrip } from "./parts";

// The auth layout (Figma Account · Web 178:2864, mobile 207:5249): demo strip, top bar, the form
// column, the help line, and the brand panel from 1024px up. Tablet is the web layout without it.

export const HELP_LINE = "Need help? Call 0306 999 0123, 8am–8pm every day.";

export interface AuthTopBar {
  text: string;
  to: "/login" | "/signup" | "/";
  label: string;
}

export function AuthShell({
  topBar,
  title,
  subtitle,
  children,
}: {
  topBar: AuthTopBar;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <div className="auth__main">
        <a href="#main" className="site-skip">
          Skip to content
        </a>
        <DemoStrip />
        <header className="auth__top">
          <Link to="/" className="auth__logo" aria-label="Kerb home">
            <Wordmark size={26} />
          </Link>
          <p className="auth__switch">
            <span className="auth__switch-text">{topBar.text}</span>
            <Link to={topBar.to} className="kb-btn kb-btn--secondary kb-btn--sm">
              <span>{topBar.label}</span>
            </Link>
          </p>
        </header>
        <main id="main" tabIndex={-1} className="auth__body">
          <div className="auth__column">
            <div className="auth__heading">
              <h1 className="auth__title">{title}</h1>
              {subtitle ? <p className="auth__subtitle">{subtitle}</p> : null}
            </div>
            {children}
          </div>
        </main>
        <p className="auth__help">{HELP_LINE}</p>
      </div>
      <BrandPanel />
    </div>
  );
}
