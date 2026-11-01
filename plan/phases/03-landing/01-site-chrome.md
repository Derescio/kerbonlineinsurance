# 3.1 Site chrome

**Status:** done (#31, 31 Oct 2026)
**Phase:** 03-landing

## Goal

Give every public page the Kerb header, footer and demo notice from the Figma landing frames, with a mobile menu that works with a keyboard and a screen reader, so 3.2–3.4 only have to build the page body.

## In scope

### Layout

- **Pathless layout route `_site`** (`src/routes/_site.tsx`): demo banner → `SiteHeader` → `<Outlet />` → `SiteFooter`. The landing moves to `src/routes/_site/index.tsx`. `/system` stays outside it: it's a reference page, not part of the site.
- **Skip link** ("Skip to content") as the first focusable element, targeting `<main id="main">`.
- **Global `main` rule** in `src/styles.css` (42rem column, 4rem margin) is removed: it would box in the full-bleed landing sections. Pages set their own width. (Check `/system` still looks right.)
- **Site 404** (`notFoundComponent` on the root route): "This page isn't built yet" in the site chrome, with a link home. Header and footer links point at their final paths (Damion's call, 30 Oct 2026), so until each phase lands they reach this page, not the router's bare default.

### Demo banner (not in Figma; required by the plan)

A thin full-width bar above the header: "Kerb is a fictional insurer made for a portfolio project. No real cover is sold." Body-S, evergreen-on-marker or stone (pick whichever passes AA against the header; confirm on the side-by-side). It's always there and can't be dismissed: the notice is a working rule, and a dismissed banner would make the cached page differ per visitor.

### `SiteHeader` (`src/components/site/SiteHeader.tsx`, Figma `54:1924` web, `103:5576` tablet, `103:5634` mobile)

- Evergreen (`--bg-inverse`) bar, 76 px, sticky. On the landing it runs into the evergreen hero, so the header has no bottom border.
- `Wordmark tone="inverse"` linking to `/` (`aria-label="Kerb home"`).
- `<nav aria-label="Main">`: Policy, Claims, Documents, Help. Figma says "Document"; the link reads "Documents" (it's the plural everywhere else, including the footer). Active item: Marker 400, `aria-current="page"`. None is active on the landing.
- Right side: **Log in** (Button `secondary` sm, `user` icon, as a link) and **Notifications** (IconButton `inverse`, `bell`, as a link). The bell is in every Figma header, so it stays even when signed out; Phase 4 decides what it shows.
- **Breakpoint:** web and tablet (≥ 768 px) show the full nav. Mobile (< 768 px) keeps Log in and the bell and swaps the nav for a **Menu** button (`menu` icon).
- **Mobile menu** (not designed in Figma): `Dialog presentation="sheet"`, title "Menu", the four nav links as a full-width list. The native `<dialog>` already traps focus, makes the page inert, closes on Escape and returns focus to the Menu button. The Menu button has `aria-expanded` and `aria-controls`. Choosing a link closes the sheet.

### `SiteFooter` (`src/components/site/SiteFooter.tsx`, Figma `54:2105` web, `88:2483` tablet, `88:2751` mobile)

- Wordmark plus four link columns, each a `<nav>` named by its mono overline heading:
  - **Insurance:** Car, Home, Condo, Tenant, Landlord, Pet insurance
  - **Claims:** Make a claim, Track a claim, Claims help, Claims FAQs
  - **Support:** Help centre, Contact us, Accessibility, Complaints, Privacy, Cookies
  - **Account:** Log in, Go to your account, Documents, Payments
- Footer line: "Kerb is a fictional insurer made for a portfolio project. No real cover is sold." (the plan's wording, which replaces Figma's "created for a design portfolio. Figures on this page are illustrative."; the "illustrative" wording moves to the trust stats in 3.3).
- Columns: 4-up on web, 4-up narrower on tablet, 2 × 2 on mobile (Figma `88:2752`).
- The dark "See your price in two minutes" CTA card sits in the same Figma frame (`54:2089`), but it's landing content, so it's built in 3.3.

### Links

One typed list in `src/components/site/links.ts` (label + path) feeds the header, menu and footer, so a path changes in one place. Routes that don't exist yet use a plain `<a href>`, because TanStack `<Link to>` won't type-check a route that isn't there; switch each one to `<Link>` when its route lands. Paths:

| Link | Path |
|---|---|
| Policy | `/account/policy` |
| Claims, Make a claim | `/claims`, `/claims/new` |
| Track a claim | `/claims/track` |
| Documents | `/account/documents` |
| Help, Help centre, Claims help, Claims FAQs | `/help`, `/help`, `/help/claims`, `/help/claims#faqs` |
| Log in, Go to your account, Payments | `/login`, `/account`, `/account/payments` |
| Notifications | `/account/notifications` |
| Car / Home / Condo / Tenant / Landlord / Pet insurance | `/insurance/car` … `/insurance/pet` |
| Contact us, Accessibility, Complaints, Privacy, Cookies | `/contact`, `/accessibility`, `/complaints`, `/privacy`, `/cookies` |

Phases 4–6 may rename these; when they do, the change is one line in `links.ts`.

## Out of scope

- Hero, trust stats, accordion, how it works, quick actions and the CTA card (3.2, 3.3).
- The header's signed-in state (account menu, notification count): Phase 4.
- The consent banner (3.5).
- The stacked-hero variant.

## Sources

- Figma High Fidelity `Landing page — Web` `53:1920`: header `54:1924` (web), `103:5576` (tablet), `103:5634` + menu button `103:5646` (mobile); footer links `54:2105`, `88:2483`, `88:2751`.
- `../ui_kits/web/Chrome.jsx` (`SiteHeader`: evergreen, sticky, Marker active item), `../templates/landing-page/LandingPage.dc.html` (header and footer markup).
- Components from Phase 2: `Wordmark`, `Button`, `IconButton`, `Dialog`, `.kb-sr-only`.
- TanStack Router: pathless layout routes, `notFoundComponent`.

## Files

- New: `src/routes/_site.tsx`, `src/routes/_site/index.tsx` (moved from `src/routes/index.tsx`), `src/components/site/{SiteHeader,SiteFooter,DemoBanner,NotFound}.tsx`, `src/components/site/links.ts`, `src/components/site/site.css`, `src/components/site/site.browser.test.tsx`.
- Changed: `src/routes/__root.tsx` (`notFoundComponent`), `src/styles.css` (drop the global `main` rule, import `site.css`), `src/routeTree.gen.ts` (generated).

## Steps

- [x] `links.ts`, `DemoBanner`, `SiteFooter` + tests.
- [x] `SiteHeader` with the mobile menu + tests (open/close, focus, Escape, link closes it).
- [x] `_site` layout, move the landing, skip link, root `notFoundComponent`; drop the global `main` rule and check `/system`.
- [x] Side by side with Figma at 1440, 1024 and 390 px wide (I'll say before running the headless browser).
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Component | Header: wordmark links home; nav is a named landmark with four links at their `links.ts` paths; Log in and Notifications are links with names | yes |
| Component | Mobile menu: Menu button has `aria-expanded` false → true; the sheet opens with the nav links; Escape closes it and focus returns to the Menu button; choosing a link closes it | yes |
| Component | Demo banner and footer line both render the notice text; footer has four named link groups | yes |
| Component | 404: an unknown path renders "This page isn't built yet" with the header, footer and a link home | yes |
| E2E | none yet: `e2e.yml` arrives in 3.4 | — |
| Manual | Header and footer next to Figma at web, tablet and mobile; Tab order: skip link → wordmark → nav → Log in → bell (→ Menu on mobile); `/system` unchanged | yes |

## Done when

- [x] `vp check`, `vp test` and `vp build` exit with 0; `ci` green on the PR.
- [x] Manual checks pass.

## Results (30 Oct 2026)

Changes from the spec:
- **No separate `DemoBanner` file:** the notice is a `<section aria-label="Demo notice">` inside the new `SiteLayout`, which also holds the skip link, header, `<main id="main">` and footer. `NotFound` uses the same layout, because an unknown path matches the root route, not `_site`.
- **Banner colour:** Marker 300 with Evergreen 900 text, 13 px.
- **Chrome links are plain `<a>`, the wordmark included.** That keeps the components free of the router (they test without one); the layout passes `pathname` in for `aria-current`. Home becomes a `<Link>` when 3.2 makes the landing worth preloading.
- **Mobile menu** has a full-width "Close" button as well as Escape and scrim click, because the sheet has no close icon.
- **Links styled as buttons** (Log in, the bell, the 404's home button) kept turning green-800 on hover from the global `a:hover`. Fixed in `components.css` "App additions (3.1)" for every button variant on an `<a>`.
- Active nav colour follows Figma (`--accent-hover`, Marker 500), not `Chrome.jsx` (Marker 400).
- Regenerating routes with the standalone `tsr` CLI drops TanStack Start's `Register` block from `routeTree.gen.ts`, which breaks the `router.tsx` type check. Let `vp build` / `vp dev` regenerate it instead.

What was built:
- `src/components/site/{SiteLayout,SiteHeader,SiteFooter,NotFound}.tsx`, `links.ts`, `site.css`; `src/routes/_site.tsx`, `src/routes/_site/index.tsx` (the landing placeholder, moved); root `notFoundComponent`; global `main` rule removed.
- Tests: `links.test.ts` (3) and `site.browser.test.tsx` (11): 122 in total, all passing. `vp check` and `vp build` clean.
- Headless check on the production build: `/` returns 200 and `/claims` returns 404 in the chrome with "Claims" marked current. Screenshots at 1440, 1024 and 390 px match the Figma header and footer (full nav down to 768 px; Log in, bell and Menu below). The menu sheet opens over a blurred page. Desktop Tab order: skip link → Kerb home → Policy → Claims → Documents → Help → Log in → Notifications. `/system` is unchanged. No console errors apart from the expected 404 response.

## Commit message

`feat: site header, footer and demo notice, with a keyboard-friendly mobile menu`
