import { Button } from "#/components/actions/Button";

import { useConsent } from "./consent";
import { cookiesLink } from "./links";

/**
 * Cookie choice bar (3.6), fixed to the bottom of the viewport until the visitor chooses. It renders
 * nothing on the server, so the CDN-cached HTML is the same for everyone. Not a dialog: the page
 * stays usable, and Accept and Reject look the same (ICO: rejecting is as easy as accepting).
 */
export function ConsentBanner() {
  const consent = useConsent();
  if (consent?.status !== "pending") return null;

  // The buttons go away with the bar, so focus moves to the page instead of being lost
  const choose = (change: () => void) => () => {
    change();
    document.getElementById("main")?.focus();
  };

  return (
    <section className="consent" aria-label="Cookie choices">
      <div className="site-container">
        <div className="consent__card">
          <p className="consent__text">
            We'd like to use cookies to see how people use Kerb, so we can improve it. We won't use
            them unless you say yes. <a href={cookiesLink.href}>Cookie policy</a>
          </p>
          <div className="consent__actions">
            <Button variant="secondary" size="sm" onClick={choose(consent.accept)}>
              Accept cookies
            </Button>
            <Button variant="secondary" size="sm" onClick={choose(consent.reject)}>
              Reject cookies
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
