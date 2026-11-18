import type { ReactNode } from "react";

import { Wordmark } from "#/components/display/Wordmark";
import { Stepper } from "#/components/navigation/Stepper";
import { CookieSettingsButton } from "#/components/site/SiteFooter";
import { cookiesLink, demoNotice, homeHref } from "#/components/site/links";
import { ClosureBanner } from "#/features/account/ClosureBanner";

import { JOURNEY_STEPS, journeyStepOf } from "./frame";
import { helpHref } from "./help";

// The quote pages' own frame (5.4b, decision 4; Revamp `249:5806`): the demo bar, a journey header
// with the Stepper and "Need help?", and a one-line footer, in place of the site chrome. It keeps
// what SiteLayout did that a quote page still needs: the skip link, `main`, the closure banner and
// a way back to the cookie choice.

export const footerLine =
  "Kerb is a fictional insurer made for a portfolio project. No real cover is sold.";

export function QuoteFrame({
  pathname,
  search,
  children,
}: {
  pathname: string;
  search: { step?: string };
  children?: ReactNode;
}) {
  const current = journeyStepOf(pathname, search);
  return (
    <div className="site quote-frame">
      <a href="#main" className="site-skip">
        Skip to content
      </a>
      {/* Always shown and not dismissable, as on every public page (Damion, 12 Nov 2026) */}
      <section className="site-demo" aria-label="Demo notice">
        <p className="site-container">{demoNotice}</p>
      </section>
      <header className="quote-frame__header">
        <div className="site-container quote-frame__bar">
          <a href={homeHref} className="quote-frame__home" aria-label="Kerb home">
            <Wordmark size={28} />
          </a>
          {current === null ? (
            <span className="quote-frame__spacer" />
          ) : (
            <>
              <div className="quote-frame__steps quote-progress--wide">
                <Stepper steps={JOURNEY_STEPS} current={current} label="Quote progress" />
              </div>
              <div className="quote-frame__steps quote-progress--narrow">
                <p className="quote-frame__step-name" aria-hidden="true">
                  Step {current + 1} of {JOURNEY_STEPS.length}: {JOURNEY_STEPS[current]}
                </p>
                <Stepper
                  steps={JOURNEY_STEPS}
                  current={current}
                  label="Quote progress"
                  variant="bar"
                />
              </div>
            </>
          )}
          <a href={helpHref} className="quote-frame__help">
            Need help?
          </a>
        </div>
      </header>
      {/* Fetched in the browser after mount, never rendered here, as in SiteLayout */}
      <ClosureBanner />
      <main id="main" tabIndex={-1} className="site-main">
        <div className="site-container">{children}</div>
      </main>
      <footer className="quote-frame__footer">
        <div className="site-container quote-frame__footer-row">
          <p>{footerLine}</p>
          <ul>
            <li>
              <a href="/privacy">Privacy</a>
            </li>
            <li>
              <a href={cookiesLink.href}>{cookiesLink.label}</a>
            </li>
            <CookieSettingsButton className="quote-frame__settings">
              {(button) => <li>{button}</li>}
            </CookieSettingsButton>
            <li>
              <a href={helpHref}>Help</a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
