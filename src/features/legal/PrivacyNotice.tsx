import { CLOSURE_WINDOW_DAYS, PRIVACY_EMAIL, RETENTION } from "#/server/account/constants";

// /privacy (4.7, spec "Screens"). Plain English, in the spec's order. It names a real business as
// the controller, so check every statement here against the code before it changes. No user
// content: the page is CDN-cached (src/routes/_site/privacy.tsx).

/** Bump when the copy changes */
export const PRIVACY_LAST_UPDATED = "7 November 2026";

const processors = [
  { name: "Vercel", does: "Hosts the website.", where: "Global network" },
  { name: "Neon", does: "Stores the database (Postgres).", where: "London, UK" },
  { name: "Resend", does: "Sends our emails.", where: "United States" },
  { name: "PostHog", does: "Analytics, only after you accept cookies.", where: "United States" },
  { name: "Google", does: "Sign-in with Google, if you choose it.", where: "United States" },
  {
    name: "Cloudflare (Turnstile)",
    does: "Checks that a form is being filled in by a person.",
    where: "Global network",
  },
];

function Mail() {
  return <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;
}

export function PrivacyNotice() {
  return (
    <article className="site-container legal">
      <h1 className="kb-h1">Privacy notice</h1>
      <p className="legal__updated">Last updated {PRIVACY_LAST_UPDATED}</p>

      <section aria-labelledby="who">
        <h2 className="kb-h2" id="who">
          Who we are
        </h2>
        <p>
          Kerb is a demonstration made by OpsEd Solutions. OpsEd Solutions is the controller of the
          personal data on this site, which means it decides how the data is used. Kerb is not a
          real insurer and sells no real cover.
        </p>
        <p>
          To ask about your data, write to <Mail />.
        </p>
      </section>

      <section aria-labelledby="collect">
        <h2 className="kb-h2" id="collect">
          What we collect and why
        </h2>
        <ul>
          <li>
            <strong>Your account.</strong> Your name, email address and a password (stored as a
            hash, never as you typed it), or your Google profile if you sign in with Google. We use
            these to run your account. Our lawful basis is contract: we need them to give you the
            service you asked for.
          </li>
          <li>
            <strong>Sign-in and account-security events.</strong> When you sign in, fail to sign in,
            reset or change your password, turn two-factor on or off, link Google or end a session,
            we record the event. We store a scrambled (hashed) version of your IP address and a
            short summary of your browser, never the IP address or full browser string itself. We
            use these to spot and stop attacks on accounts. Our lawful basis is legitimate
            interests: keeping accounts safe.
          </li>
          <li>
            <strong>Analytics.</strong> We use PostHog to see how the site is used. Until you accept
            cookies it runs without cookies and counts visits anonymously. If you accept, it stores
            a cookie and local storage that recognise you between visits and may record how you use
            pages. Our lawful basis is your consent, and you can change your mind any time on the{" "}
            <a href="/cookies">cookies page</a>.
          </li>
          <li>
            <strong>Emails.</strong> We send the emails your account needs, like confirming your
            address, resetting a password or telling you about closing your account. Resend sends
            them for us, so it sees your address and the message.
          </li>
        </ul>
      </section>

      <section aria-labelledby="processors">
        <h2 className="kb-h2" id="processors">
          Who processes it, and where
        </h2>
        <p>These companies handle data for us, and only to do the job below.</p>
        <table className="legal__table">
          <caption className="legal__caption">Our processors</caption>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">What it does</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {processors.map((processor) => (
              <tr key={processor.name}>
                <td>{processor.name}</td>
                <td>{processor.does}</td>
                <td>{processor.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="keep">
        <h2 className="kb-h2" id="keep">
          How long we keep it
        </h2>
        <p>
          Kerb sells no real cover, so it has no real retention rules. These periods are
          illustrative: they show how a notice like this would work, and they are not legal advice.
        </p>
        <table className="legal__table">
          <caption className="legal__caption">How long we keep it (illustrative)</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Kept for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account details, while your account is open</td>
              <td>Until you delete or close the account</td>
            </tr>
            <tr>
              <td>Insurance records (policies, payments, claims)</td>
              <td>{RETENTION.insuranceRecordsYears} years after your account closes</td>
            </tr>
            <tr>
              <td>Sign-in and account-security events</td>
              <td>
                {RETENTION.securityEventsMonths} months is the period we aim for. Automatic deletion
                is not in place yet, so these are kept until it is.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="rights">
        <h2 className="kb-h2" id="rights">
          Your rights
        </h2>
        <p>
          You can ask us for access to your data, to correct it, to erase it, to restrict how we use
          it, to object to how we use it, and to receive it in a portable form.
        </p>
        <p>
          To ask, email <Mail />. We will reply within one month. If you are unhappy with our
          answer, you can complain to the{" "}
          <a href="https://ico.org.uk/make-a-complaint/">
            Information Commissioner&rsquo;s Office (ICO)
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="closing">
        <h2 className="kb-h2" id="closing">
          Closing your account
        </h2>
        <p>
          You can <a href="/account/close">close your account</a> when you are signed in. There are
          two ways it can go.
        </p>
        <ul>
          <li>
            <strong>Nothing on file.</strong> If you have no policies, payments or claims, your
            account and everything in it is deleted straight away.
          </li>
          <li>
            <strong>Insurance records on file.</strong> Your account closes after{" "}
            {CLOSURE_WINDOW_DAYS} days, and you can change your mind any time before then. If you
            have an open claim, the account closes once that claim is settled. When it closes, we
            delete your sign-in details (password, Google link, sessions, two-factor and any reset
            links), your notifications, your reviews, and any draft claims and quotes you never
            bought. The login email and name on the account are replaced, so the account can&rsquo;t
            be used again. We keep your customer record (name, address and date of birth), policies,
            claims, payments, and the security and audit history for the periods in the table above,
            because we must keep insurance records.
          </li>
        </ul>
      </section>
    </article>
  );
}
