# 3.3 Landing parts

**Status:** in-progress (approved 31 Oct 2026, without the illustrative note under the trust strip; built, waiting for PR)
**Phase:** 03-landing

## Goal

Build everything on the landing page below the hero, from the Figma split-hero frame: trust strip, insurance types accordion, how it works, quick actions and the closing CTA card. Also add the excess callout. All of it works before hydration, and nothing on it looks like a real review score or regulator figure.

## What Figma has (and where it differs from the slice title)

The final Figma page (`53:1936`) is: Hero → **Trust strip** `54:1994` → **Insurance types** `62:2137` → **How it works** `54:2008` → **Quick actions** `54:2028` → **CTA card** `54:2089` → footer.

- **"Steps"** is the How it works section, which Figma redesigned as a photo plus a three-item check list. The `Landing/Step card` part (`53:1952`, numbered cards) is no longer on the page, so it isn't built.
- **Trust stats:** three in Figma, not four.
- **Excess callout:** the `Landing/Excess callout` part (`53:1945`) exists ("Floating card over the hero photo"), but no frame places it. See decision 1.

## Decisions for you

1. **Excess callout: put it on the hero photo.** I'd float it over the top-right corner of the hero photo on web and tablet, as the part's description and the old template say, and hide it on mobile, where the photo is 220 px tall and a 142 px card would cover it. That touches `Hero.tsx` from 3.2. The alternative is to leave it out because Figma doesn't place it. Copy, from the part: overline "Voluntary excess", "£250", "Plus £100 compulsory excess, £350 total. We'll always show this up front." The figures are illustrative, so they count towards the note in decision 2.
2. **Trust strip copy.** Slot 1 shows "Reviews coming soon" with the caption "Ratings from real Kerb customers will show here.", as already agreed (6.9 wires the real average; no stars until then). Slots 2 and 3 keep Figma's "Fast Claims" / "Average time to a claim decision" and "24/7 Support" / "UK team, 7 days a week".
   **Approved without an illustrative note under the strip** (Damion, 31 Oct 2026): the demo banner and footer line already say Kerb is fictional, and none of the three stats is a number. The test checks instead that no review score, review count, star or FCA number is in the markup. Two problems with Figma's copy: "24/7" and "7 days a week" don't say the same thing, so I'd make it **"7-day support"**. And "Fast Claims" is title case, which I'd change to **"Fast claims"** for sentence case. Say if you want Figma's exact wording instead.
3. **Accordion copy.** Figma's car text is North American ("auto coverage", "accident benefits", "ticket forgiveness"). I'd rewrite it in UK terms: *"Comprehensive, third party, fire and theft, or third party only. Add breakdown cover, a courtesy car or legal cover, and see your excess before you pay."* The other five have no body text in Figma. Each one gets one plain line on what it covers, then *"Kerb only sells car insurance for now."* There's no CTA, because only car has a live one (phase decision).
4. **"Land insurance" becomes "Landlord insurance"**, to match the footer and `/insurance/landlord`. The icon stays as Figma's.

Approved on 31 Oct 2026 as recommended, except where decision 2 says otherwise.

## In scope

All the sections go in `src/features/landing/`, use the 1152 px `site-container`, and go into `landing.css`. The landing route renders them in Figma order.

### `TrustStrip` (Figma `54:1994` web, `103:5588` tablet, `103:5648` mobile)

- `<section aria-label="Kerb at a glance">`, 56 px vertical padding. Three stats in a row, each with a 1 px `--stone-200` left divider except the first (the part's own rule). Value: Bricolage 700 36/40, −0.03 em. Caption: 15/22 `--stone-600`.
- On mobile they stack, with no dividers (`103:5648`).
- The stats are a `<dl>`: caption as `<dt>`, value as `<dd>`, shown value first with CSS `order` so the screen-reader order still reads naturally.

### `InsuranceTypes` (Figma `62:2137` web, `88:2348` tablet, `88:2616` mobile)

- White band with top and bottom hairlines, 64 px padding. Overline "What we cover" (mono 13/16, `--green-700`). `<h2>` "Insurance for every situation" (Display-L 44/48 on web, `clamp()` down to about 36 px on mobile).
- Six items in Figma order: car, home, condo in the left column; tenant, landlord, pet in the right. Two columns from 768 px, one below.
- **Each item is a native `<details>` / `<summary>`**: it opens with Enter, Space or a click, and it works with no JS and on a prerendered page. Items open and close on their own (no `name` group), and **car is open by default**.
- Closed: white, 1 px `--stone-200` border, 16 px radius, 20/24 padding, icon + semibold 16/22 label, `chevron-down` on the right. Open: `--green-900` card, white label, chevron turned 180°, body text 15/24 at white 72 %.
- Car's body ends with `Button` accent sm "Get a car insurance quote" + `arrow-right`, as a link to `quoteHref`.
- Figma's 2 px black border on Tenant is the focus state. In code that's a `:focus-visible` ring on the `<summary>`, using the system's focus token.
- The default marker is hidden (`list-style: none` and `::-webkit-details-marker`). The chevron is decorative, because `<summary>` already tells assistive tech whether it's open.
- **Icons:** car and house come from Lucide (already in `icons.ts`). Condo, tenant, land and pet are Figma's custom glyphs (`110:2583`, `110:2585`, `110:2588`, `110:2591`). They become small SVG components in `src/components/display/custom-icons.tsx`, with the same props as a Lucide icon and Figma's paths and 1.8 stroke kept as they are, and they're registered in `icons.ts` as `condo`, `tenant`, `land` and `pet`. That way `<Icon name="pet" />` works, and `/system` lists them for free.

### `HowItWorks` (Figma `54:2008` web, `103:5611` tablet, `103:5671` mobile)

- Two columns: the photo (600 × 520 on web, 16 px radius, 10 % evergreen overlay) and the content (520 px). On tablet the photo is 464 × 360. On mobile the photo goes on top (260 px tall), then the content.
- Overline "How it works", `<h2>` "From quote to covered in minutes" (H1 style, 34/40).
- **An `<ol>` of three steps**, each with a 40 px `--green-50` circle and a `check` icon, a title (22/28 Bricolage 700) and a line of Body-S `--stone-600`:
  1. Get a quote: "Enter your postcode. It takes about two minutes." (Figma's em dash becomes a full stop)
  2. Review and choose your cover: "See your price, excess and optional extras."
  3. Purchase and manage your policy: "Pay monthly or annually, then access your policy online."
- `Button` primary sm "Get a quote" + `arrow-right`, as a link to `quoteHref`.
- **Photo:** Figma's image (1120 × 747 JPEG, exported from `94:2510`) goes in `src/assets/how-it-works-laptop.jpg`. It goes through vite-imagetools like the hero (AVIF/WebP/JPEG at 480, 768 and 1120), with `loading="lazy"` because it's below the fold, width and height set, and `alt=""`, because it's decorative. A `ResponsiveImage` helper shared with `HeroImage` keeps the `<picture>` markup in one place.

### `QuickActions` (Figma `54:2028` web, `88:2401` tablet, `88:2669` mobile)

- White band with hairlines, 64 px padding. `<h2>` "Already with Kerb?" (36/41), the subheading "You don't need to log in for these.", and on the right the underlined link "Go to your account" (`/account`). On mobile the link drops under the subheading.
- **Four tiles**, each a whole-tile `<a>` (the `Landing/Quick action` part): 40 px `--green-100` chip with a 20 px icon, title semibold 16/22, subtitle Body-S. 1 px `--stone-200` border, 16 px radius, 20 px padding; the border goes `--stone-400` on hover (the part's note). Four across on web, 2 × 2 on tablet, stacked on mobile.

| Tile | Subtitle | Icon | Path |
|---|---|---|---|
| Make a claim | Around 10 minutes | `file-plus` | `/claims/new` |
| Track a claim | With your claim reference | `clock` | `/claims/track` |
| Get your documents | Certificate and policy schedule | `file-text` | `/account/documents` |
| Make a payment | Card or bank transfer | `credit-card` | `/account/payments` |

- The paths come from `links.ts`. The footer already has the same four, so they get named exports there and both use them.

### `ClosingCta` (Figma `54:2089`; the mobile version is in `88:2725`)

- `--green-900` card, 24 px radius, 72 px padding (`clamp()` down to 32 px), `--shadow-3`, with 88 px of space above the footer. `<h2>` "See your price in two minutes." (Bricolage 800 52/55, clamped), and "No account needed. We'll save your quote for 30 days." at 18/28, white 78 %.
- Actions: `Button` accent lg "Get a quote" + `arrow-right`, as a link to `quoteHref`, plus the underlined white link "Continue a saved quote" (`retrieveQuoteLink`). On mobile the button is full width and the link sits under it.
- **Accent count:** Figma uses accent for the hero, car and CTA-card buttons. Figma's own Button note says "max one per screen", and these are never on screen together, so I'll follow Figma.

### `ExcessCallout` (Figma part `53:1945`; decision 1)

- White card, 220 px wide, 16 px radius, `--shadow-2`, 16/18 padding: overline (mono 12, `--stone-600`), amount (Bricolage 700 28/32), explanation (13/18 `--stone-600`).
- It sits absolutely over the hero photo, 24 px from the top and right, from 768 px up, and is hidden below 768 px. It's in the markup, not a pseudo-element, so screen readers get it as a short `<aside aria-label="Example excess">`.

## Out of scope

- The numbered `Landing/Step card` (Figma dropped it).
- Real review scores and stars (6.9).
- A sticky mobile "Get a quote" bar and fine responsive tuning (3.4).
- Pages for the other insurance types; their footer links stay pointed at the site 404.
- PostHog events on these CTAs (3.5).

## Sources

- Figma `Landing page – Web` `53:1920`: web `53:1936` (sections above), tablet `88:2254`, mobile `88:2528`; parts `53:1943` (`Landing/Excess callout` `53:1945`, `Landing/Trust stat` `53:1949`, `Landing/Quick action` `53:1957`).
- `../templates/landing-page/LandingPage.dc.html` (trust strip, quick actions and CTA card markup; excess callout position).
- Phase 2 parts: `Button` (as a link), `Icon`, `.kb-sr-only`. 3.1: `site-container`, `links.ts`. 3.2: `HeroImage` and the vite-imagetools setup.
- [plan/research/competitors.md](../../research/competitors.md) takeaways 4 (illustrative stats) and 7 (claims quick action).

## Files

- New: `src/features/landing/{TrustStrip,InsuranceTypes,HowItWorks,QuickActions,ClosingCta,ExcessCallout,ResponsiveImage}.tsx`, `src/features/landing/landing-parts.browser.test.tsx`, `src/components/display/custom-icons.tsx`, `src/assets/how-it-works-laptop.jpg`.
- Changed: `src/routes/_site/index.tsx` (renders the sections), `src/features/landing/{Hero,HeroImage}.tsx` (callout over the photo, shared `ResponsiveImage`), `src/features/landing/landing.css`, `src/components/display/icons.ts` (four custom icons), `src/components/site/links.ts` (quick-action links shared with the footer), `src/routes/-system/sections/Icons.tsx` if it doesn't pick the new icons up by itself, `plan/phases/03-landing/phase.md`, `plan/build-plan.md`.

## Steps

- [x] Custom icons + registry; check them on `/system`.
- [x] `ResponsiveImage` (move `HeroImage` onto it; the hero tests still pass), the How it works photo.
- [x] `TrustStrip`, `InsuranceTypes`, `HowItWorks`, `QuickActions`, `ClosingCta`, `ExcessCallout`, plus tests.
- [x] Landing route renders them in Figma order.
- [x] Side by side with Figma at 1440, 1024 and 390 px (I'll say before running the headless browser); check that CLS stays 0 and the LCP is still the hero image.
- [x] `vp check --fix`, `vp check`, `vp test`, `vp build`.

## Tests

| Layer | Test | Gate |
|---|---|---|
| Component | Trust strip: three stats, "Reviews coming soon" in the first slot; the markup has no rating pattern (`/\d(\.\d)?\s*\/\s*5/`), no "reviews" count, no star icons, and no FCA or "firm reference" text | yes |
| Component | Accordion: six `<summary>` items in order; car open by default with a "Get a car insurance quote" link to `/quote`; clicking Home opens it and shows "Kerb only sells car insurance for now"; only car has a quote link | yes |
| Component | How it works: `<h2>` plus an `<ol>` with three items; the "Get a quote" link points at `/quote`; the photo is lazy, with width, height and `alt=""` | yes |
| Component | Quick actions: four links with the names and paths in the table; "Go to your account" goes to `/account` | yes |
| Component | CTA card: "Get a quote" goes to `/quote`, "Continue a saved quote" goes to `/quote/retrieve` | yes |
| Component | Excess callout: an `aside` named "Example excess" showing £250 inside the hero | yes |
| Component | Landing: `h1` then `h2`s in Figma order (no skipped levels) | yes |
| Unit | `links.test.ts`: quick-action paths match the footer's | yes |
| E2E | none yet: `e2e.yml` arrives in 3.4 | — |
| Manual | Sections next to Figma at web, tablet and mobile; accordion works by keyboard with the focus ring visible; the page works with JS turned off (accordion included); CLS 0 | yes |

## Done when

- [ ] `vp check`, `vp test` and `vp build` exit with 0; `ci` green on the PR.
- [ ] Manual checks pass.

## Results (31 Oct 2026)

Changes from the spec:
- **Trust stats are a `<ul>`, not a `<dl>`.** With "Reviews coming soon" in the first slot, a caption-as-term list read back to front; value then caption reads naturally.
- **`ButtonLink`** (`src/features/landing/ButtonLink.tsx`): the quote CTAs are links that look like `Button` + arrow, like the 3.1 chrome links. Three uses here, so it's a small component rather than repeated markup. It could move to `components/actions` if Phase 5 needs it.
- **`LandingPage`** (`src/features/landing/LandingPage.tsx`) holds the section order, so the route file only exports `Route` and the heading-order test renders the real page.
- **Quick actions** go 2 × 2 below 1024 px, not across the whole tablet range: Figma's tablet frame (1024) is four across, but the tiles get too narrow below that.
- **CTA heading** drops `text-wrap: balance`, so it breaks where Figma does ("See your price in two / minutes.").
- **Callout tests** find the `aside` by selector. Playwright's role engine treats an `<aside>` inside a `<section>` as generic even when it's named; browsers follow HTML-AAM and expose a named one as complementary. Also, `toHaveTextContent("£250")` needs the whole text, so the test checks `textContent` instead.
- The four custom icons keep Figma's 1.8 stroke; `/system` lists them with the Lucide set (its intro now says so).

What was built:
- `src/features/landing/{TrustStrip,InsuranceTypes,HowItWorks,QuickActions,ClosingCta,ExcessCallout,ResponsiveImage,ButtonLink,LandingPage}.tsx`, landing-part styles in `landing.css`; `src/components/display/custom-icons.tsx` (condo, tenant, land, pet in `icons.ts`); `src/assets/how-it-works-laptop.jpg`; shared claim/account links in `links.ts`; `HeroImage` now uses `ResponsiveImage`, and the hero photo carries the excess callout.
- Tests: `landing-parts.browser.test.tsx` (13) and one more in `links.test.ts`: 142 in total, all passing. `vp check` and `vp build` clean.
- Build output: the How it works photo as AVIF, WebP and JPEG at 480, 768 and 1120 px (AVIF 13 kB at 480 px).
- Headless check on the production build at 1440, 1024, 800 and 390 px: CLS 0, the LCP is still the hero AVIF, no horizontal scroll, no console errors. Sections match Figma `53:1936`, `88:2254` and `88:2528`. With JS off, the accordion still opens; Enter on a focused summary opens it, and the focus ring shows on the item as Figma draws it on Tenant.

## Commit message

`feat: landing trust strip, insurance types accordion, how it works, quick actions and closing CTA`
