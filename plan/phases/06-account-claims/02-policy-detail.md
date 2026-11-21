# 6.2 Policy detail

**Status:** draft (awaiting Damion's approval)
**Phase:** 06-account-claims

## Goal

A customer can open any of their policies and see what it covers. They can also download its certificate of insurance and its policy schedule as PDFs.
- **Policy detail** at `/account/policies/{reference}`, built from Figma's Policy overview (`183:3507`).
- **The Policies and Documents tabs** in the account shell, each with its page.
- **Two PDFs**, made when they're asked for, from data only the policy's owner can read.

**Why:** the Overview lists policies but stops there. Its rows aren't links, and a customer has no way to see their excess or drivers, or to get the certificate that proves they're insured. 6.3's "Make a change" and 6.4's "Start a claim" both start from this page.

## What exists already

- **The account shell** ([AccountShell.tsx](../../../src/features/account/AccountShell.tsx)) shows only the Overview tab. 6.1 decided that tabs appear with their pages (decision 1).
- **Overview rows** ([Overview.tsx](../../../src/features/account/Overview.tsx)) show the plate and car, or the address, plus cover level, a status badge and "Renews {date}". They aren't links yet ("Rows aren't links until 6.2", 6.1 decision 5).
- **`getMyPolicy`** ([policies.ts](../../../src/server/data/policies.ts)) is in the permission suite. It reads one policy by id, filtered by `customerId`, and returns the summary fields, the premium, both excesses, `autoRenew` and claims. It has no car, drivers, home, add-ons or payment plan.
- **What a policy insures** is stored on its quote item and never changes after purchase: `vehicles`, `drivers` (`isMain`, licence years) and `properties` (rebuild cost, contents, valuables). Cover tier and excess are on `quote_item_options`; add-ons, with selected and price, on `quote_item_addons`; premium, saving, IPT and total on `quotes`. `getPurchase` ([quotes.ts](../../../src/server/data/quotes.ts)) already reads most of this for the pay screen.
- **Documents:** none exist. The schema spec (4.2, [02-schema.md](../04-data-auth/02-schema.md)) decided the certificate and schedule are made on demand, not stored in `files`. No PDF library is installed. The fonts are self-hosted from `@fontsource` (`src/styles/fonts.css`).
- **The covered page** ([CoveredPage.tsx](../../../src/features/quote/CoveredPage.tsx)) left "View policy" and documents to 6.2 and links only to `/account`.
- **Planned links** in [links.ts](../../../src/components/site/links.ts): `documentsLink` → `/account/documents`, and the footer's "Policy" → `/account/policy`.
- **Figma:** Policy overview (`183:3507`) is a car policy. It has the plate and status, the car and reference, "Certificate" and "Start a claim" buttons, and four stat cards: Cover, Excess (with an info icon), Per month and Renews. Below those are the "Make a change" grid (six cards), Drivers ("+ Add") and Documents (certificate, schedule, policy wording and the insurance product information document, IPID). There is no home frame and no Policies or Documents page.

## Decisions

1. **The URL uses the reference:** `/account/policies/KRB-818784`. References are unique (`policies_reference_check`) and are what the customer sees on every email and page. The read filters by `customerId`, so someone else's reference returns the same "not found" as one that doesn't exist. The page is `private, no-store`, like every account page. *(my call)*
2. **Policies and Documents tabs** (Damion, 20 Nov 2026). The shell becomes Overview · Policies · Documents. Claims still waits for 6.4.
   - **`/account/policies`:** every policy the customer has, newest first, as the Overview draws them: the same rows, statuses and bundle grouping, with no stat cards. Cancelled and ended policies are listed too, with their badge.
   - **Rows are links**, with a chevron, on both the Overview and Policies. Each opens that policy's detail page.
   - **`/account/documents`:** the documents for every policy, grouped under each policy's label (the plate and car, or the address) with its reference. The rows match the detail page's Documents card (decision 5). No policies: "You don’t have any documents yet. They’ll appear here when you buy a policy." with "Get a quote".
   - The footer's "Policy" link points at `/account/policies`, and `documentsLink` keeps `/account/documents`.
3. **The page follows the frame, without the actions that don't work yet** (Damion, 20 Nov 2026).
   - **The header:** "All policies" (back to `/account/policies`), then the status badge from the Overview. For a car, the plate, "{make} {model}", and "{reference} · {variant}, {year}" in mono. For a home, "{line 1}, {town}" as the title and "{reference} · {property type}, {postcode}".
   - **"Certificate"** downloads the certificate for a car policy that has one (decision 5). A home policy has no certificate, so the button isn't shown.
   - **Hidden until their slices ship:** "Start a claim" (6.4), the "Make a change" section (6.3) and the Drivers card's "+ Add" (6.3). 6.1's rule again: nothing on the page leads nowhere.
4. **Stat cards:** Cover, Excess, the price, and the dates.
   - **Cover:** the cover level ("Comprehensive", "Standard").
   - **Excess:** compulsory plus voluntary. The info icon opens a tooltip: "£100 compulsory + £150 voluntary". With no voluntary excess it says "£250 compulsory".
   - **Price:** a monthly payer (a Stripe subscription, as on the Overview) sees "Per month" with the instalment from `payments`. For a car + home bundle, that instalment covers both, so the card adds "Car and home together". An annual payer sees "A year" with `annual_premium_pence` (after any saving, matching the Overview). *(my call: a bundle's payments are per quote, not per policy)*
   - **Dates:** "Renews 14 Mar 2027" (the day after `ends_on`, as on the Overview) for an active policy. A policy that starts later shows "Starts 3 Dec 2026", a cancelled one "Cancelled 2 Feb 2027", an ended one "Ended 13 Mar 2027". A lapsed one shows "Lapsed", with the Overview's message underneath ("Your payment didn’t go through…") and "Manage payments".
5. **Documents: the certificate and the schedule** (Damion, 20 Nov 2026). The policy wording and the IPID rows aren't shown until they're written.
   - **Certificate of motor insurance:** car policies only, while the policy is active or starts later. A lapsed, cancelled or ended policy has no certificate, because it would claim cover that isn't in force. Its schedule stays available. *(my call)*
   - **Policy schedule:** every policy, whatever its status.
   - **Each row:** the document's name, "PDF · {date the policy was bought}" and a download icon. The documents can't change until 6.3 adds `policy_versions`, so the purchase date is the version date. 6.3 decides how a changed policy's documents are dated.
6. **Drivers (car) and Your home (home)** sit beside Documents.
   - **Drivers:** each driver's initials, name, and "Main driver · 9 years licence" or "{relationship} · 3 years licence". The main driver comes first.
   - **Your home** (no frame, so it reuses the card's style): rebuild cost, contents, valuables (when stated), bedrooms and year built.
   - Claims are left out. There are none to show until 6.4, and 6.6 brings the claim list.
7. **How the PDFs are made** (Damion, 20 Nov 2026: `@react-pdf/renderer`).
   - **A server route:** `GET /api/policies/{reference}/documents/{certificate|schedule}`. No session gets 401. Another customer's policy, or a certificate that doesn't apply (decision 5), gets 404. It sends `private, no-store` and `Content-Disposition: attachment; filename="Kerb-KRB-818784-certificate.pdf"`.
   - **One read for the page and the PDFs:** `getMyPolicy` takes the reference and returns everything the page and both documents need. The route calls it through the same `signed_in` access check, so the permission suite covers it.
   - **Nothing is stored,** and no audit row is written: a customer reading their own documents writes none, as the phase's testing table says for claims. A rate limit through `rate_limits` (30 a minute per user) keeps PDF rendering from being used to load the server. *(my call)*
   - **Fonts:** the brand faces registered from the `@fontsource` files. react-pdf can't read WOFF2 or variable fonts, so it uses static `.woff` weights. The `@fontsource-variable` packages ship only WOFF2, so the static `@fontsource` packages (or TTFs from them) are added for the PDFs alone.
8. **What each PDF says.** Every page carries "Kerb demo: this is not a real insurance document" in the footer, since Kerb is a demo and these must never pass as proof of cover. *(my call)*
   - **Certificate of motor insurance:** certificate number (the reference), the registration mark, the policyholder, the start and expiry dates, who may drive (the named drivers), the use the car is covered for (`usage`), and the Road Traffic Act 1988 statement, worded as the demo it is.
   - **Policy schedule:** the policyholder and their address, the reference, the period of cover, the cover level, and what's insured. For a car, the car, registration, value, usage and drivers; for a home, the address, property type, rebuild cost, contents and valuables. Then the excesses, the selected add-ons, and the price: premium, any saving ("Bundle saving" or "Your saving", as on the pay screen), add-ons, IPT and total. Last, the payment plan.
9. **The covered page links to the policy.** After purchase, CoveredPage gains "View your policy" next to the existing account link. A bundle gets one link per policy. *(my call: 5.6 left this for 6.2)*

## In scope

- `/account/policies`, `/account/policies/{reference}` and `/account/documents`, inside the shell; the Policies and Documents tabs
- Overview and Policies rows as links
- `getMyPolicy` widened and keyed by reference
- The documents route, the certificate and the schedule, and `@react-pdf/renderer`
- The covered page's "View your policy"
- The footer's "Policy" link

## Out of scope

- "Make a change", "+ Add" driver, and every policy change: 6.3
- "Start a claim", the Claims tab and the policy's claims: 6.4–6.6
- The policy wording and the IPID
- Emailing documents, or attaching them to `policy_confirmed`
- Renewal and "Review renewal": no slice yet
- Mobile and tablet frames: the pages adapt the web frame, as 6.1 did

## Tests

| Layer | What |
|---|---|
| Integration | `getMyPolicy` by reference returns the car with its drivers (main first) or the home, the excesses, add-ons, price and payment plan, for the customer's own policy only. Another customer's reference and an unknown one both give `NOT_FOUND`. It stays in the permission suite |
| Integration | The documents route: no session gets 401; another customer's policy 404; a home policy's certificate 404; a lapsed or cancelled car's certificate 404 while its schedule downloads. A good request returns `application/pdf`, `private, no-store` and the attachment filename. The PDF's text (read with a PDF parser in the test) has the reference, the start and end dates and the demo line. The rate limit refuses the 31st request in a minute |
| Component | Policy detail, car: plate, car, reference, status, the four stat cards (monthly, annual, a bundle's "Car and home together"), the excess tooltip, drivers, and the two document rows. Home: the address title, Your home, no Certificate button and only the schedule. Lapsed: the message and no certificate. "Start a claim", "Make a change" and "+ Add" absent |
| Component | Account shell: Overview, Policies and Documents tabs, the current one marked. Policies and Overview rows link to the detail page. Documents groups by policy and has the empty state |
| E2E | Buy a car policy → Overview → open the policy → the plate, cover and drivers show → "Certificate" downloads a PDF → the Documents tab lists the certificate and schedule. axe on all three new pages |

## Done when

- A customer can open each of their policies from the Overview or Policies, and the page matches frame `183:3507` without the hidden actions, at desktop and phone width.
- The certificate and schedule download for the owner only, with the right policy's details and the demo line.
- The Documents tab lists every policy's documents.
- The tests above pass in `ci`.
- Preview manual check by Damion.

## Commit message

`feat: open any of your policies to see its cover, excess, price and drivers or home, and download its certificate and schedule as PDFs`

## Sources

- The 6.2 row in [phase.md](phase.md), and its testing row: "Policy documents download only for the owner; the PDF has the policy number and dates"
- Figma Account · Policy `183:3502`: Policy overview `183:3507`; `Acct / Header` `181:3310`, `Plate` `181:3317`
- 6.1 [01-dashboard.md](01-dashboard.md) for the shell, the row labels, the status badges and "Renews"
- 4.2 [02-schema.md](../04-data-auth/02-schema.md) for documents made on demand
