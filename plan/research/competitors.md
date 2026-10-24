# Competitor review

**Researched:** 16 Oct 2026 · **Scope:** UX patterns, not market positioning · **Screenshots:** `img/` (desktop 1440px and mobile 390px). These are for internal reference only; don't publish them in the video without checking fair use.

## Summary

Every insurer we looked at does the same few things: one input to start a quote, quantified trust signals, Claims in the top navigation, a bottom-right chat button, and a self-service list built around changing drivers, vehicles, address and documents.

Kerb's designs already cover most of this. There are four gaps worth closing:

1. **A one-field quote start on the landing page**, using a number plate.
2. **A "Retrieve my quote" route** back to an unfinished quote.
3. **A cover comparison table** at the cover-options step.
4. **A clear "Kerb is a demo" notice.** That one matters more for us than for any of them, because we take real sign-ups for a fictional insurer.

## Who we looked at

**Damion's picks:**

| Site | What it is | Captured |
|---|---|---|
| [belairdirect](https://www.belairdirect.com/) | Canadian direct insurer (Intact group) | Homepage via headless browser (blocks plain fetches) |
| [Rates.ca](https://rates.ca/) | Canadian comparison site | Homepage via headless browser |
| [Progressive](https://www.progressive.com/) + [manage policy](https://www.progressive.com/manage-policy/) | US insurer | Homepage, self-service page |
| [Sonnet](https://www.sonnet.ca/) | Canadian digital insurer (Definity) | Homepage |

**UK digital and incumbent insurers, plus the AI benchmark:**

| Site | What it is | Captured |
|---|---|---|
| [Marshmallow](https://www.marshmallow.com/) | UK digital insurer | Homepage |
| [Cuvva](https://www.cuvva.com/) | UK temporary cover, app-first | Homepage |
| [By Miles](https://www.bymiles.co.uk/) | UK pay-per-mile (closed to new customers at the time of review) | Homepage |
| [Admiral](https://www.admiral.com/car-insurance) | UK incumbent | Car insurance page |
| [Lemonade](https://www.lemonade.com/car) | US, AI-first benchmark | Car page via headless browser |

**Not reviewed:** Zego and Direct Line, which are optional for later. Quote flows and logged-in account areas, because they sit behind forms and logins. If you want those, click through and send screenshots.

## Pattern by pattern

### 1. Landing → first input

| Site | Headline | First action |
|---|---|---|
| Progressive | "Better insurance starts here" | **ZIP code** field + "Get a quote", inside a card in the first screen on mobile |
| Rates.ca | "Get a better rate." | Product tabs, then **postal code** + "Get My Quote" |
| belairdirect | Contest promo ("Win a bill-free decade!") | Product buttons (Car + home / Car / Home), "Retrieve my quote", Online / By phone tabs |
| Sonnet | "Adulting is hard. Sonnet is simple." | "Get a quote" → product picker; a **province modal blocks the page first** |
| Admiral | "Trust us – we've been doing car insurance for over 30 years" | "Start my quote" (reg number first) + **"Retrieve my quote"** |
| Lemonade | "Car insurance that costs less for safe drivers" | One button: "CHECK OUR PRICES" |
| Marshmallow | "Insurance priced on you" | "Get a free quote" → separate quote landing |

**What it tells us:** the strongest starts ask for **one field right in the hero**. For a UK car insurer that field is the **number plate**, and the Kerb design system already has a number-plate field in Marker yellow. Modals in front of the content (Sonnet, and belairdirect's province and cookie bar) feel like friction.

### 2. Trust signals

The trust signals that work are **quantified and sourced**:
- Admiral: "Trustpilot 4.7/5 from 31,165 reviews", "98.9% claims acceptance", "5 million vehicles"
- Marshmallow: "30,000 5-star reviews", "FCA Regulated (797672)"
- Cuvva: "16 million+ policies sold"
- belairdirect: "18,800 reviews on Google, 4.4 out of 5", with named reviewer quotes
- Sonnet: Trustpilot, plus "600 claims team members"

**What it tells us:** Kerb is fictional, so **we can't publish made-up review scores or regulator numbers** as if they were real. Use plainly fictional or illustrative trust parts (the Figma "Trust stat" part), and show a site-wide "Kerb is a demo, not a real insurer" notice. See the takeaways below.

### 3. Cover levels and price transparency

- **Admiral** has a full matrix: Third Party → TPFT → Essential / Admiral / Gold / Platinum, with benefits (windscreen, courtesy car, legal) ticked per tier. It's the clearest comparison we saw.
- **By Miles** explains its price in parts: "an upfront fixed fee" + "per-mile rate". It's honest that this is "just an idea of what you'll pay".
- **Cuvva** shows "from" prices with a footnote: "Price paid by 10% of Cuvva customers".

**What it tells us:** Kerb's `priceQuote()` already produces a breakdown, so show it. Give the cover-options step a compact comparison table alongside the CoverageOption cards.

### 4. Chat and assistants

| Site | Pattern |
|---|---|
| belairdirect | **Floating round chat button, bottom-right**, on every page |
| Progressive | "Chat with Flo" as a **link** under Resources, framed as customer service |
| Rates.ca, belairdirect | **Mascots**: a waving robot, a knight |
| Marshmallow, Cuvva, By Miles | They sell **human** support: "Sick of hold music? So are we." Live chat in the app with set hours |
| Admiral | No assistant visible on the car page |

Lemonade is known for its AI assistant, but the public car page we captured doesn't show it. It sits inside the quote and claims flows.

**What it tells us:**
- The bottom-right launcher is the convention, so use it.
- Nobody we saw gives a **signed-in assistant that can actually change your policy**. That's Kerbie's real edge, and a good video moment.
- Customers value knowing when a human is available. Kerbie should say plainly that it's an AI assistant and point to "contact us" for anything it can't do.
- Kerb's visual rules say **no illustration**, so Kerbie should use a simple glyph or wordmark avatar, not a mascot.

### 5. Self-service

Progressive's manage-policy page is a good checklist of what customers expect to do on their own:
- policy details
- billing and payments, autopay, statements
- **update drivers**, **update vehicles**, **change coverage**
- discounts
- **ID cards / proof of insurance** (download, print, email)
- documents
- file, track and review claims

They group it into four headings: Manage your policy · Pay your bill · Claims · ID cards and proof of insurance. There's also a quick "Make a payment" without logging in.

Marshmallow and Cuvva push the app ("change details on the go", "all your documents in one place").

**What it tells us:** Kerb's plan covers drivers, address, cover level and claims. It's missing **documents / certificate of motor insurance** (the UK version of ID cards), which most UK customers look for first. **Adding a vehicle** is also missing; it's probably out of scope for now.

### 6. Claims entry

- Claims is a **top-level nav item** on Progressive, belairdirect, Sonnet and Admiral.
- Progressive shows an **emergency banner** for a hurricane: "We hope you're OK…" with three ways to report.
- Cuvva's guidance: "Report all incidents within 24 hours, even if you don't plan to claim."
- By Miles has no claims route on its homepage. That's a gap a reviewer would call out.

**What it tells us:** Kerb's chrome should have "Claims" at the top level and a "Start a claim" quick action on the landing page (the Figma "Quick action" part). Put the "call 999 first" line (already in Kerb's voice rules) in the claims entry.

### 7. Tone

- Sonnet and Lemonade are playful ("Adulting is hard", "WHOA, we'll plant trees").
- Progressive and Admiral are reassuring and corporate.
- Marshmallow and Cuvva are friendly and plain.

Kerb's "calm, competent friend" sits between friendly and reassuring, with no jokes in serious moments. That's distinct, and right for claims. **Keep it.**

### 8. Mobile

Progressive's mobile homepage puts the quote card (ZIP + "Get a quote") in the first screen, with a sticky "Contact us" bar at the bottom. Marshmallow and Cuvva drive people to the app. Kerb is web only, so the first mobile screen needs to carry the quote start.

## Takeaways mapped to slices

| # | Takeaway | Slice | Change |
|---|---|---|---|
| 1 | **"Kerb is a demo" notice**: thin site-wide banner + footer line + note on sign-up ("Kerb is a fictional insurer made for a portfolio project. No real cover is sold.") | 3.1, 4.4, 4.5 | **Add.** Needed because real people sign up. |
| 2 | **Number-plate input in the hero** that carries into the vehicle step | 3.2, 5.2 | Check the Figma split hero. If it only has a button, propose adding the plate field (the DS component exists). |
| 3 | **"Retrieve my quote"** link in the hero and header; quotes saved for signed-in users | 3.2, 5.6 | Add. |
| 4 | Trust stats are **illustrative, not fake-real**: no invented Trustpilot or FCA numbers | 3.3 | Copy rule for the trust stat part. |
| 5 | **Cover comparison table** next to the CoverageOption cards | 5.5 | Add. |
| 6 | **Price breakdown** on the summary ("Your price is made up of…") | 5.5 | Show the `priceQuote()` breakdown. |
| 7 | **Claims in the top nav** + "Start a claim" quick action + "call 999 first" at the claims entry | 3.1, 3.3, 6.4 | Check against Figma. |
| 8 | **Documents: certificate of insurance and policy schedule** (generated PDF or HTML) | 6.2 | Add to policy detail; Kerbie read tool `getMyDocuments`. |
| 9 | Kerbie: **bottom-right launcher**, glyph avatar (no mascot), says it's AI, hands off to "contact us" | 7.1 | Design brief input. |
| 10 | Kerbie's actions are **the differentiator**: none of the competitors had an assistant that changes your policy | 7.x, video | Lead with it in the website video. |
| 11 | **No blocking modals**: UK only, so no region picker; non-blocking cookie notice | 3.1, 8.1 | Add. |
| 12 | **Mobile first screen** carries the quote start; consider a sticky "Get a quote" bar | 3.4 | Responsive pass. |

**Decisions (16 Oct 2026):** Damion approved takeaways 1, 3, 4, 5, 6, 8 and 9; they're now in `build-plan.md`. **Takeaway 2 (number plate in the hero) was declined.** Takeaways 7, 10, 11 and 12 weren't put to Damion separately; we'll check them when those slices are specced.

## Not doing (on purpose)

- ~~**Bundles**~~: changed on 16 Oct 2026. Damion wants car, home, business and bundles in the data model and pricing now, with only car buyable at launch.
- **Contests and promos** in the hero (belairdirect). They clash with Kerb's calm voice.
- **Usage-based / telematics** pricing (Progressive Snapshot, Lemonade, By Miles). Out of scope.
