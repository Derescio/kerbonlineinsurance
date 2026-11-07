import { useConsent } from "#/components/site/consent";
import { CookieSettingsButton } from "#/components/site/SiteFooter";

import { COOKIES } from "./cookies";

// /cookies (4.7, spec "Screens"): every cookie the site sets, from `cookies.ts`, and the way back
// into the 3.6 choice bar. CDN-cached, so nothing here depends on the visitor.

export function CookiesPage() {
  const running = useConsent() !== null;
  return (
    <article className="site-container legal">
      <h1 className="kb-h1">Cookies</h1>
      <p>
        Kerb sets the cookies below. The sign-in cookies are needed to run your account. The
        analytics cookie is only set if you accept cookies, and until then PostHog runs without
        cookies. The <a href="/privacy">privacy notice</a> has the rest.
      </p>

      <div className="legal__scroll">
        <table className="legal__table">
          <caption className="legal__caption">Cookies Kerb sets</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">What it is for</th>
              <th scope="col">How long</th>
              <th scope="col">Set</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((cookie) => (
              <tr key={cookie.name}>
                <td>
                  <code>{cookie.name}</code>
                </td>
                <td>{cookie.purpose}</td>
                <td>{cookie.duration}</td>
                <td>{cookie.when === "always" ? "When needed" : "After you accept"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legal__note">
        Over a secure connection, each sign-in cookie name starts with <code>__Secure-</code>.
      </p>

      <h2 className="kb-h2">Change your choice</h2>
      {running ? (
        <CookieSettingsButton className="kb-btn kb-btn--secondary" />
      ) : (
        <p>
          The Cookie settings button shows here once analytics has loaded. If you can&rsquo;t see
          it, analytics isn&rsquo;t running on this device, so the PostHog cookie isn&rsquo;t set.
        </p>
      )}
    </article>
  );
}
