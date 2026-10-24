# Phase 2: Design system

**Tag:** `s2-design-system` · **Status:** todo

## Goal

Port the Kerb tokens and every component from the parent design-system folder (`../`, outside this repo) into the app as typed TSX, so later phases build with real Kerb parts.

## Payoff shot

The `/system` page: every component in every state, matching the Figma Foundation Design page side by side.

## Slices

Specced in full when this phase starts.

| # | Slice | Status |
|---|---|---|
| 2.1 | Tokens and fonts. **Perf:** self-hosted woff2 fonts, subset, preloaded, `font-display: swap` | todo |
| 2.2 | Display and action components → TSX | todo |
| 2.3 | Form components → TSX | todo |
| 2.4 | Feedback, navigation and insurance components → TSX | todo |
| 2.5 | `/system` page | todo |

## Recording notes

- Show the Figma variables next to `tokens/colors.css`: the design system is the same in both places.
- The `.d.ts` files become the component prop types. A good moment to talk about typing a design system.
- Sources (in the parent folder; copy them in, never import across `../`, because CI and Vercel only see this repo): `../tokens/*.css`, `../components/**`, `../components/kerb-components.css`, Figma page `Foundation Design` (4:2) and the component pages listed in [figma.md](../../figma.md).

## Exit criteria

- `/system` renders every component without console errors.
- Visual check against Figma Foundation Design.
- `vp check`, `vp test`, `vp build` pass.
