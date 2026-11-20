import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { IconButton } from "#/components/actions/IconButton";
import { Icon } from "#/components/display/Icon";
import { Wordmark } from "#/components/display/Wordmark";
import { Dialog } from "#/components/feedback/Dialog";
import { useToast } from "#/components/feedback/Toaster";
import { MenuButton, type MenuItem } from "#/components/navigation/MenuButton";
import { logOutHome } from "#/features/auth/log-out";

import {
  accountMenuLinks,
  homeHref,
  isCurrent,
  loginLink,
  mainNav,
  notificationsLink,
} from "./links";
import { useSessionHint } from "./use-session-hint";

export interface SiteHeaderProps {
  /** Current path, to mark the active nav item. The layout passes the router's location. */
  pathname?: string;
}

const menuId = "site-menu";

/**
 * Evergreen site header (Figma 54:1924 web, 103:5576 tablet, 103:5634 mobile). Under 768px the nav
 * moves into a bottom-sheet menu; Log in and the bell stay in the bar. Signed in, Log in becomes
 * "My account" once the session hint answers (6.1, decision 8): the cached HTML always says Log in.
 * Clicking that link still goes to /login, which sends a signed-in visitor straight on.
 */
export function SiteHeader({ pathname }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);
  const signedIn = useSessionHint() === "signed-in";
  const toast = useToast();

  async function logOut() {
    const failed = await logOutHome();
    if (failed) toast({ tone: "danger", title: "Still signed in", message: failed });
  }
  const accountItems: MenuItem[] = [...accountMenuLinks, { label: "Log out", onSelect: logOut }];

  return (
    <header className="site-header">
      <div className="site-container site-header__bar">
        <a href={homeHref} className="site-header__home" aria-label="Kerb home">
          <Wordmark tone="inverse" size={28} />
        </a>

        <nav className="site-header__nav" aria-label="Main">
          <ul>
            {mainNav.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  aria-current={isCurrent(link.href, pathname) ? "page" : undefined}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__account">
          {/* Button and IconButton styles on links: these go to pages, they don't act in place */}
          {signedIn ? (
            <MenuButton
              items={accountItems}
              buttonClassName="kb-btn kb-btn--secondary kb-btn--sm site-header__login"
            >
              <Icon name="user" size={16} />
              <span>My account</span>
            </MenuButton>
          ) : (
            <a
              href={loginLink.href}
              className="kb-btn kb-btn--secondary kb-btn--sm site-header__login"
            >
              <Icon name="user" size={16} />
              <span>{loginLink.label}</span>
            </a>
          )}
          <a
            href={notificationsLink.href}
            className="kb-iconbtn kb-iconbtn--inverse kb-iconbtn--sm"
            aria-label={notificationsLink.label}
            title={notificationsLink.label}
          >
            <Icon name="bell" size={16} />
          </a>
        </div>

        <IconButton
          icon="menu"
          label="Menu"
          variant="secondary"
          className="site-header__menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen(true)}
        />
      </div>

      <Dialog
        open={menuOpen}
        onClose={close}
        title="Menu"
        presentation="sheet"
        className="site-menu"
        actions={
          <Button variant="secondary" fullWidth onClick={close}>
            Close
          </Button>
        }
      >
        <ul className="site-menu__list" id={menuId}>
          {mainNav.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={isCurrent(link.href, pathname) ? "page" : undefined}
                onClick={close}
              >
                {link.label}
                <Icon name="chevron-right" size={18} />
              </a>
            </li>
          ))}
          {signedIn ? (
            <>
              {accountMenuLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} onClick={close}>
                    {link.label}
                    <Icon name="chevron-right" size={18} />
                  </a>
                </li>
              ))}
              <li>
                <button type="button" className="site-menu__action" onClick={() => void logOut()}>
                  Log out
                </button>
              </li>
            </>
          ) : null}
        </ul>
      </Dialog>
    </header>
  );
}
