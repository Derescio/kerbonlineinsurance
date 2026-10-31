// Every header, menu and footer link, in one place. Most of these pages aren't built yet and reach
// the site 404 until their phase lands (plan/phases/03-landing/phase.md, "Decisions"). They're
// plain hrefs, because TanStack <Link to> only type-checks routes that exist; switch a link to
// <Link> when its route lands.

export interface SiteLink {
  label: string;
  href: string;
}

export const homeHref = "/";
/** Quote journey start (Phase 5); the hero form sends `?postcode=` here. */
export const quoteHref = "/quote";
export const retrieveQuoteLink: SiteLink = {
  label: "Continue a saved quote",
  href: "/quote/retrieve",
};
export const loginLink: SiteLink = { label: "Log in", href: "/login" };
export const notificationsLink: SiteLink = {
  label: "Notifications",
  href: "/account/notifications",
};

// In the footer and the landing's quick actions (3.3), so the two can't drift apart
export const accountLink: SiteLink = { label: "Go to your account", href: "/account" };
export const makeClaimLink: SiteLink = { label: "Make a claim", href: "/claims/new" };
export const trackClaimLink: SiteLink = { label: "Track a claim", href: "/claims/track" };
export const documentsLink: SiteLink = { label: "Documents", href: "/account/documents" };
export const paymentsLink: SiteLink = { label: "Payments", href: "/account/payments" };

/** Header nav, and the mobile menu. */
export const mainNav: SiteLink[] = [
  { label: "Policy", href: "/account/policy" },
  { label: "Claims", href: "/claims" },
  { label: "Documents", href: "/account/documents" },
  { label: "Help", href: "/help" },
];

/** Footer link columns, in Figma order (54:2111). */
export const footerGroups: { title: string; links: SiteLink[] }[] = [
  {
    title: "Insurance",
    links: [
      { label: "Car insurance", href: "/insurance/car" },
      { label: "Home insurance", href: "/insurance/home" },
      { label: "Condo insurance", href: "/insurance/condo" },
      { label: "Tenant insurance", href: "/insurance/tenant" },
      { label: "Landlord insurance", href: "/insurance/landlord" },
      { label: "Pet insurance", href: "/insurance/pet" },
    ],
  },
  {
    title: "Claims",
    links: [
      makeClaimLink,
      trackClaimLink,
      { label: "Claims help", href: "/help/claims" },
      { label: "Claims FAQs", href: "/help/claims#faqs" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help centre", href: "/help" },
      { label: "Contact us", href: "/contact" },
      { label: "Accessibility", href: "/accessibility" },
      { label: "Complaints", href: "/complaints" },
      { label: "Privacy", href: "/privacy" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
  {
    title: "Account",
    links: [loginLink, accountLink, documentsLink, paymentsLink],
  },
];

/** True when `href` is the current page or a parent of it, for aria-current. */
export function isCurrent(href: string, pathname: string | undefined): boolean {
  if (!pathname || href === homeHref) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const demoNotice =
  "Kerb is a fictional insurer made for a portfolio project. No real cover is sold.";
