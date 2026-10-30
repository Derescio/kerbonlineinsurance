# Phase 2: Design system

**Tag:** `s2-design-system` · **Status:** in progress

## Goal

Port the Kerb tokens and every component from the parent design-system folder (`../`, outside this repo) into the app as typed TSX, so later phases build with real Kerb parts.

## Payoff shot

The `/system` page: every component in every state, matching the Figma Foundation Design page side by side.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 2.1 | [Tokens and fonts](01-tokens-fonts.md). **Perf:** self-hosted woff2 fonts, subset, preloaded, `font-display: swap` | done |
| 2.2 | [Display and action components](02-display-actions.md) → TSX | spec |
| 2.3 | Form components → TSX | todo |
| 2.4 | Feedback, navigation and insurance components → TSX | todo |
| 2.5 | `/system` page | todo |

## Recording notes

- Show the Figma variables next to `tokens/colors.css`: the design system is the same in both places.
- The `.d.ts` files become the component prop types. A good moment to talk about typing a design system.
- Sources (in the parent folder; copy them in, never import across `../`, because CI and Vercel only see this repo): `../tokens/*.css`, `../components/**`, `../components/kerb-components.css`, Figma page `Foundation Design` (4:2) and the component pages listed in [figma.md](../../figma.md).

## Testing

Layers and tooling: [engineering.md §4](../../engineering.md#testing). This phase adds the `component` Vitest project (browser mode, Chromium) and the Chromium step in `ci.yml`, in 2.2.

| Layer | What | Slice | Gate? |
|---|---|---|---|
| Unit | Token helpers, if any (for example a class-name or variant helper) | 2.1 | yes |
| Component | Every display and action component renders each state from its `.d.ts`: variant, size, disabled, loading; buttons fire once and not when disabled | 2.2 | yes |
| Component | Form components: label tied to the input, error text linked with `aria-describedby`, keyboard works (Tab, Space/Enter, arrow keys for radio groups, select and stepper), visible focus ring | 2.3 | yes |
| Component | Feedback, navigation and insurance components: alerts use the right role, tabs/menus move focus with arrow keys, `CoverageOption` selects with the keyboard, `Timeline` renders items in order | 2.4 | yes |
| Manual | `/system` side by side with Figma Foundation Design; fonts load from our own origin (network tab), no layout shift on font swap | 2.1, 2.5 | yes |

## Exit criteria

- `/system` renders every component without console errors.
- Visual check against Figma Foundation Design.
- Component tests pass in CI on Chromium.
- `vp check`, `vp test`, `vp build` pass.
