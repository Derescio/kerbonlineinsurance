import { useId } from "react";

import { Wordmark } from "#/components/display/Wordmark";

import { demoNotice, footerGroups, homeHref, type SiteLink } from "./links";

/** Site footer: wordmark, four link columns and the demo line (Figma 54:2105, 88:2483, 88:2751). */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer__row">
          <a href={homeHref} className="site-footer__home" aria-label="Kerb home">
            <Wordmark size={22} />
          </a>
          <div className="site-footer__columns">
            {footerGroups.map((group) => (
              <FooterGroup key={group.title} {...group} />
            ))}
          </div>
        </div>
        <p className="site-footer__legal">{demoNotice}</p>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: SiteLink[] }) {
  const id = useId();
  return (
    <nav className="site-footer__group" aria-labelledby={id}>
      <h2 className="kb-overline site-footer__title" id={id}>
        {title}
      </h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
