# Figma map

File: [Kerb Online Insurance](https://www.figma.com/design/ajpEaPwbWtwbsSmRheyDAU/Kerb-Online-Insurance), key `ajpEaPwbWtwbsSmRheyDAU`. Checked 24 Oct 2026; re-audited 29 Oct 2026 through the Figma MCP. Node IDs go in each slice's **Sources**.

**Build from High Fidelity.** Use Lo Fidelity only where a screen has no high-fidelity version yet.

## Pages

| Page | Node | Used by |
|---|---|---|
| High Fidelity Wireframes | `32:15957` | Phases 3, 5, 6: the build source |
| Lo Fidelity Wireframes | `18:7822` | Layout reference, landing variations |
| Account · Web | `177:2850` | 4.3 auth screens, 6.3 settings, 6.x policy management, 6.8 admin |
| Kerbie | `187:2850` | 7.1 Kerbie mark and panel |
| Foundation Design | `4:2` | 2.1 tokens and fonts |
| Actions | `4:5` | 2.2 |
| Display | `4:7` | 2.2 |
| Forms | `4:6` | 2.3 |
| Feedback | `4:9` | 2.4 |
| Navigation | `4:8` | 2.4 |
| Insurance | `4:10` | 2.4 |
| Icons | `4:4` | 2.x (icon set) |
| Competitor | `48:4449` | Research only (see [research/competitors.md](research/competitors.md)) |
| Promotion Page | `128:11021` | Device mockups for marketing, not a build source |
| Cover | `0:1` | — |

## High Fidelity Wireframes (`32:15957`)

| Frame | Node | Phase |
|---|---|---|
| Landing page – Web (Variants, Responsive variants) | `53:1920` | 3 |
| Quote & Policy – Web | `37:32276` | 5 |
| Quote & Policy – Tablet | `37:33059` | 5 |
| Quote & Policy – Mobile | `37:33842` | 5 |
| Claims – Web | `37:29813` | 6 |
| Claims – Tablet | `37:30650` | 6 |
| Claims – Mobile | `37:31506` | 6 |
| Rating / 5 Stars (component) | `104:2502` | 6.9 reviews |

## Quote · Phase 5 additions, Web (`222:6701`)

Drawn by Damion on 9 Nov 2026 to fill the gaps in the `Quote & Policy` journey above. Web only: tablet and mobile adapt these with the existing `Quote & Policy – Tablet / Mobile` frames (Damion, 9 Nov 2026). The header in these frames is a placeholder; the build uses the live site header from 3.1, and Figma is updated to match later.

| # | Screen | Node | Slice |
|---|---|---|---|
| 01 | Quote start: type picker + postcode from the link | `222:6702` | 5.1 |
| 02 | Coming soon, with car and home offered instead | `222:6717` | 5.1 |
| 03 | Home quote referred | `222:6732` | 5.5 |
| 04 | Bundle partially declined (home declined, car buyable) | `222:6747` | 5.5 |
| 05 | Home · Property | `222:6762` | 5.7 |
| 06 | Home · Contents & security | `222:6777` | 5.7 |
| 07 | Home · Past claims | `222:6792` | 5.7 |
| 08 | Car · Enter registration. The build adds the demo plates under the box; `KR24 BXL` is only the placeholder, since the lookup knows just the six demo plates (5.2, call 6) | `226:624` | 5.2 |
| 09 | Car · Manual vehicle picker (make → model → year → variant) | `226:639` | 5.2 |
| 10 | Car · Vehicle not found | `226:654` | 5.2 |
| 11 | Car · Licence & driving | `226:669` | 5.3 |
| 12 | Car · Claims & convictions. Built as "Claims" without the convictions card (5.3, decision 3); Figma loses it too | `226:684` | 5.3 |
| 12a | Car · Named drivers (drawn 11 Nov 2026). Built without the convictions question (5.3, decision 3) | `235:1638` | 5.3 |
| 13 | Cover cards & comparison (1440 wide). Its monthly figures (annual ÷ 12) and footnote are out of date: paying monthly costs 10% more, so £458.40 a year is 12 payments of £42.02 (5.4, decision 1) | `226:699` | 5.5 |
| 14 | Before payment · Sign in | `226:714` | 5.6 |
| 15 | Before payment · Create account | `226:729` | 5.6 |
| 16 | Retrieve quote · Access (email link): **not built**, sign-in only (Damion, 9 Nov 2026) | `226:744` | — |
| 17 | Retrieve quote · Saved quotes | `226:759` | 5.6 |
| 18 | You're covered | `226:774` | 5.6 |
| 19 | Car · Referred | `226:789` | 5.5 |
| 20 | Car declined · Home available | `226:804` | 5.5 |
| 21 | Start a car + home bundle | `230:1434` | 5.5 / 5.7 |
| 22 | Home quote & choose cover (1440 wide) | `230:1449` | 5.7 |

**About you (5.3):** the `Quote & Policy – Web` step "Tell us about you and your car" (`157:10429`) is the car journey's About you screen, before screen 11. It's built as "Tell us about you", without the overnight parking question (moved to 11) or the confirmation box (moved to 12).

**Stepper:** both journeys use "Your details · Your quote · Choose cover · Buy" (Damion, 9 Nov 2026). Screens 05–07 draw a home-only Stepper; property, contents and claims are the three parts of "Your details".

**To update in Figma:** screens 21 and 22 say "no bundle discount", but bundles keep the 8% discount from rating tables v1 (Damion, 9 Nov 2026). Show the saving instead.

## Lo Fidelity Wireframes (`18:7822`)

| Frame | Node |
|---|---|
| Variation 1 – Split hero landing (the chosen direction) | `73:5087` |
| Variation 2 – Stacked hero landing | `73:4963` |
| Web / Tablet / Mobile quote journey | `27:12907` / `27:14169` / `27:15450` |
| Web / Tablet / Mobile claims journey | `18:8598` / `18:8202` / `18:7823` |

## Account · Web (`177:2850`)

| Frame | Node | Screens | Phase |
|---|---|---|---|
| Local components · Account | `177:2851` | Auth divider, Google button, brand panel, password hint, code input, Turnstile, backup codes, demo strip; `Acct / Header`; `Plate` (S/M/L); `Ops / Sidebar`; 18 extra icons (below) | 4.3, 6.x |
| Account · Web (auth) | `178:2864` | 01 log in, 02 password error, 02b too many tries, 02c confirm your email first `212:6156` (4.4b), 03 create account, 03b breached password, 03c check your inbox `212:6295` (4.4b), 04 reset password, 05 reset link sent | 4.3, 4.4b |
| Account · Web (recovery and verify) | `205:4404` | 06 set a new password, 06b reset link expired, 07 verify banner (with the Ways to log in / Connect Google panel `209:6239`, 4.4; the banner retired in 4.4b), 07b banner resent (retired in 4.4b), 07c email confirmed, 07d confirm link expired, 08 Google sign-in failed, 08b Google refused, account already exists `209:6005` (4.4). 07d updated in 4.4b (6 hours, email field) | 4.3, 4.4, 4.4b |
| Account · Web (two-factor) | `205:4701` | 09 code, 09b wrong code, 10 backup code, 11a–11c setup (password, scan, backup codes), 12 staff 2FA required, 13 staff "confirm it's you" dialog. Added in 4.6: 09b too many tries `213:6338`, 11a (Google) confirm with Google `213:6290`, 11b (mobile, 390) scan with "Open in authenticator app" first `213:6410` | 4.3, 4.6 |
| Account · Mobile (auth) | `207:5249` | Every screen above at 390 px except 13; 08b `209:6142` and the Connect Google panel `209:6260` added in 4.4 | 4.3, 4.4 |
| Account · Settings | `182:3249` | Personal details (view, editing), notifications, payment methods, communication preferences | 6.3 |
| Account · Policy | `183:3502` | Policy overview, plus the six "Make a change" dialogs | 6.x |
| Ops · Admin | `184:3886` | Overview, customers, policies, payments, customer panel, refund dialog | 6.8 |

## Kerbie (`187:2850`)

| Frame | Node | Notes |
|---|---|---|
| Kerbie / Mark (component) | `187:2857` | States: Idle, Listening, Thinking, Answering, Calm |
| Kerbie · Guidelines | `187:2858` | Mark directions (A "Kerb line" recommended), states and product tints, panel in context (quote playful, claim calm with handoff) |

## Component pages vs the local design-system folder

All 20 local components (`../components/**`) have a matching Figma component set, and the variant names match the `.d.ts` unions. Building blocks (Tab, Step, Coverage feature, Timeline item) are sub-parts, not separate components.

| Page | Component sets (node) |
|---|---|
| Actions `4:5` | Button `5:306` (5 variants × sm/md/lg × default/disabled), IconButton `5:356` |
| Display `4:7` | Badge `6:30`, Tag `6:54`, Card `6:72`, Wordmark `6:82`; **Mobile components** `124:2500` (header, form actions, page heading, car condition, quote progress, bottom navigation) |
| Forms `4:6` | Input `7:96` (default/plate), Select `7:131`, Checkbox `7:157`, Radio `7:179`, Switch `7:197` |
| Feedback `4:9` | Alert `11:105`, Toast `11:173`, Tooltip `11:185`, Dialog `11:266` (modal/sheet) |
| Navigation `4:8` | Tabs `9:50`, Stepper `9:259` (default/compact/bar); Status Bar (iOS) and Bottom Navigation (mobile mockups) |
| Insurance `4:10` | CoverageOption `14:74`, Timeline `14:132` |
| Icons `4:4` | 30 Lucide icons in `Icons / Grid` `4:11`, plus custom `tenant`, `pet`, `condo` (frames, not yet components) |

**Foundations `4:2`:** colour primitives, semantic colours, spacing and radii match `../tokens/*.css` exactly. They are real Figma variables (collection `Primitives`, plus `alpha/*` effect colours) and text styles. A `Rating / 5 Stars` instance sits here too (`98:6015`).

## Gaps found in the audit

- **Missing local sources** that Figma names as its origin: `ui_kits/account/{login,settings,policy,admin}.html` and `guidelines/kerbie-*.html`. Neither is in the parent folder. Figma is the source until they turn up.
- **Text styles with no reusable class:** `Heading/Price`, `Heading/Plan`, `Heading/Dialog`, `Mono/Reference`, `Mono/Plate`. Their values are hard-coded inside `kerb-components.css` (price, dialog title, plan name, plate input). 2.1 adds them as tokens and classes.
- **Icons:** 16 extra Lucide icons on the Account page (mail, pencil, landmark, user-plus, shield, refresh-cw, x-circle, trash-2, layout-dashboard, users, file-warning, file-search, search, undo-2, external-link, circle) and the custom `tenant`/`pet`/`condo`. `Icon.jsx` loads Lucide from unpkg, which the CSP blocks; self-host or use `lucide-react` in 2.2.
- **Fonts:** `../tokens/fonts.css` imports Google Fonts; 2.1 self-hosts woff2 instead.
- **No Menu component**, though the 2.4 test row mentions menus.
- **Mobile components** (Display page) have no local files; build them with the screens that use them (Phase 5).

## Not in Figma yet (design before building)

- Review UI (6.7)
- Staff claims console (6.10)
- Kerbie confirm cards (7.1); the panel and mark are designed
