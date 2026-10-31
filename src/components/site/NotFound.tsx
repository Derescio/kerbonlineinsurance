import { Icon } from "#/components/display/Icon";

import { homeHref } from "./links";
import { SiteLayout } from "./SiteLayout";

/**
 * Site 404, in the chrome. Header and footer links point at their final paths, so until each
 * phase builds its pages they land here (plan/phases/03-landing/phase.md, "Decisions").
 */
export function NotFound({ pathname }: { pathname?: string }) {
  return (
    <SiteLayout pathname={pathname}>
      <div className="site-container site-notfound">
        <p className="kb-overline site-notfound__code">404</p>
        <h1 className="kb-h1">This page isn't built yet</h1>
        <p className="kb-body-l site-notfound__body">
          Kerb is a demo that grows a phase at a time, and this part hasn't been made. The quote
          journey and your account are on their way.
        </p>
        <a href={homeHref} className="kb-btn kb-btn--primary">
          <Icon name="arrow-left" size={18} />
          <span>Back to the home page</span>
        </a>
      </div>
    </SiteLayout>
  );
}
