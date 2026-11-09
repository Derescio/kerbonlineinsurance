import { Button } from "#/components/actions/Button";
import { Icon } from "#/components/display/Icon";
import { Wordmark } from "#/components/display/Wordmark";
import { demoNotice } from "#/components/site/links";
import { cx } from "#/lib/cx";

import { PASSWORD_MIN } from "./schemas";

// Small parts of the auth screens (Figma Local components · Account 177:2851, 4.3).

/** The site's demo notice at the top of every auth screen (Auth / Demo strip 203:4515) */
export function DemoStrip() {
  return (
    <section className="auth-demo" aria-label="Demo notice">
      <p>{demoNotice}</p>
    </section>
  );
}

/** Google's "G", unaltered colours (Google sign-in branding rules) */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Continue with Google (Auth / Google button 177:2863): full width, secondary style */
export function GoogleButton({
  onClick,
  loading = false,
  label = "Continue with Google",
}: {
  onClick: () => void;
  loading?: boolean;
  label?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="lg"
      fullWidth
      loading={loading}
      onClick={onClick}
      className="auth-google"
    >
      {loading ? null : <GoogleMark />}
      {label}
    </Button>
  );
}

/** The one password rule shown (Auth / Password hint 203:4397): ticks once it's met */
export function PasswordHint({ password, id }: { password: string; id?: string }) {
  const met = password.length >= PASSWORD_MIN;
  return (
    <p id={id} className={cx("auth-hint", met && "auth-hint--met")}>
      <Icon name={met ? "circle-check" : "circle"} size={14} />
      <span>
        At least {PASSWORD_MIN} characters
        <span className="kb-sr-only">{met ? " (done)" : ""}</span>
      </span>
    </p>
  );
}

/** "or" between Google and the email form (Auth / Divider 177:2859) */
export function AuthDivider({ children = "or" }: { children?: string }) {
  return (
    <div className="auth-divider" role="separator">
      <span>{children}</span>
    </div>
  );
}

/** The right-hand panel on web (Auth / Brand panel 177:2900); hidden below 1024px */
export function BrandPanel() {
  return (
    <aside className="auth-brand" aria-hidden="true">
      <Wordmark tone="inverse" size={28} />
      <div className="auth-brand__photo">
        <span>Photo: driver getting into a car, morning light</span>
      </div>
      <p className="auth-brand__title">Your policy, documents and claims in one place.</p>
      <ul className="auth-brand__list">
        <li>
          <Icon name="check" size={16} /> Download your certificate any time
        </li>
        <li>
          <Icon name="check" size={16} /> Change your car, address or drivers
        </li>
        <li>
          <Icon name="check" size={16} /> Make and track a claim
        </li>
      </ul>
    </aside>
  );
}
