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
| Local components · Account | `177:2851` | Auth divider, social buttons, brand panel; `Acct / Header`; `Plate` (S/M/L); `Ops / Sidebar`; 16 extra icons (below) | 4.3, 6.x |
| Account · Web (auth) | `178:2864` | Log in, password error, create account, reset password, reset link sent | 4.3 |
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

- 2FA screens and the Google sign-in flow beyond the social button (4.3)
- Review UI (6.7)
- Staff claims console (6.10)
- Kerbie confirm cards (7.1); the panel and mark are designed
