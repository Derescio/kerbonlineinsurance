import type { ReactNode } from "react";

import { demoNotice } from "./links";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export interface SiteLayoutProps {
  /** Current path, for the header's active item. */
  pathname?: string;
  children?: ReactNode;
}

/** Public-page chrome: skip link, demo notice, header, main and footer. */
export function SiteLayout({ pathname, children }: SiteLayoutProps) {
  return (
    <div className="site">
      <a href="#main" className="site-skip">
        Skip to content
      </a>
      {/* Always shown and not dismissable: the notice is a working rule, and a dismissed banner would make the cached page differ per visitor */}
      <section className="site-demo" aria-label="Demo notice">
        <p className="site-container">{demoNotice}</p>
      </section>
      <SiteHeader pathname={pathname} />
      <main id="main" tabIndex={-1} className="site-main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
